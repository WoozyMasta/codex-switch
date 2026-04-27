import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ProfileManager } from '../auth/profile-manager'
import {
  getDefaultCodexAuthPath,
  loadAuthDataFromFile,
  shouldUseWslAuthPath,
} from '../auth/auth-manager'

/**
 * Register all extension commands
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  onAuthChanged: () => Promise<void>,
) {
  type StatusBarClickBehavior = 'cycle' | 'toggleLast'
  const restartExtensionHostCommandId = 'workbench.action.restartExtensionHost'
  const reloadWindowCommandId = 'workbench.action.reloadWindow'

  const maybeRestartAfterProfileSwitch = async () => {
    const reloadAfterSwitch = vscode.workspace
      .getConfiguration('codexSwitch')
      .get<boolean>('reloadWindowAfterProfileSwitch', false)
    if (!reloadAfterSwitch) {
      return
    }

    const commandIds = await vscode.commands.getCommands(true)
    if (commandIds.includes(restartExtensionHostCommandId)) {
      try {
        await vscode.commands.executeCommand(restartExtensionHostCommandId)
        return
      } catch {
        // Fall back to full window reload on older or restricted hosts.
      }
    }

    await vscode.commands.executeCommand(reloadWindowCommandId)
  }

  const getLoginCommandText = (): string =>
    shouldUseWslAuthPath() ? 'wsl codex login' : 'codex login'

  const getStatusBarClickBehavior = (): StatusBarClickBehavior => {
    const raw = vscode.workspace
      .getConfiguration('codexSwitch')
      .get<StatusBarClickBehavior>('statusBarClickBehavior', 'cycle')
    return raw === 'toggleLast' ? 'toggleLast' : 'cycle'
  }

  const getDefaultSettingsExportUri = (): vscode.Uri => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const baseDir = workspacePath || os.homedir()
    return vscode.Uri.file(path.join(baseDir, 'codex-switch-profiles.json'))
  }

  // Login command
  const loginCommand = vscode.commands.registerCommand(
    'codex-switch.login',
    async () => {
      const loginCommandText = getLoginCommandText()
      const loginSequence = `${loginCommandText}\n`
      const manageLabel = vscode.l10n.t('Manage profiles')
      const openTerminalLabel = vscode.l10n.t('Open terminal')
      const copyCommandLabel = vscode.l10n.t('Copy command')

      const selection = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Authentication required. Add a profile or run "{0}".',
          loginCommandText,
        ),
        manageLabel,
        openTerminalLabel,
        copyCommandLabel,
      )

      if (selection === manageLabel) {
        await vscode.commands.executeCommand('codex-switch.profile.manage')
      } else if (selection === openTerminalLabel) {
        vscode.commands.executeCommand('workbench.action.terminal.new')
        setTimeout(() => {
          vscode.commands.executeCommand(
            'workbench.action.terminal.sendSequence',
            {
              text: loginSequence,
            },
          )
        }, 500)
      } else if (selection === copyCommandLabel) {
        vscode.env.clipboard.writeText(loginCommandText)
        vscode.window.showInformationMessage(
          vscode.l10n.t('Command "{0}" copied to clipboard.', loginCommandText),
        )
      }
    },
  )

  const switchProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.switch',
    async () => {
      const profiles = await profileManager.listProfiles()
      if (profiles.length === 0) {
        await vscode.commands.executeCommand('codex-switch.profile.manage')
        return
      }

      const activeId = await profileManager.getActiveProfileId()
      const pick = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: p.name,
          description: p.email && p.email !== 'Unknown' ? p.email : undefined,
          detail: p.id === activeId ? vscode.l10n.t('Active') : undefined,
          profileId: p.id,
        })),
        { placeHolder: vscode.l10n.t('Switch profile') },
      )

      if (!pick) {
        return
      }
      const ok = await profileManager.setActiveProfileId(pick.profileId)
      if (!ok) {
        return
      }
      await onAuthChanged()
      await maybeRestartAfterProfileSwitch()
    },
  )

  const activateProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.activate',
    async (profileId?: string) => {
      if (!profileId) {
        await vscode.commands.executeCommand('codex-switch.profile.switch')
        return
      }

      const ok = await profileManager.setActiveProfileId(profileId)
      if (!ok) {
        return
      }

      await onAuthChanged()
      await maybeRestartAfterProfileSwitch()
    },
  )

  const toggleLastProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.toggleLast',
    async () => {
      const behavior = getStatusBarClickBehavior()
      if (behavior === 'toggleLast') {
        const newId = await profileManager.toggleLastProfileId()
        if (!newId) {
          await vscode.commands.executeCommand('codex-switch.profile.switch')
          return
        }
        await onAuthChanged()
        await maybeRestartAfterProfileSwitch()
        return
      }

      const profiles = await profileManager.listProfiles()
      if (profiles.length === 0) {
        await vscode.commands.executeCommand('codex-switch.profile.manage')
        return
      }

      const activeId = await profileManager.getActiveProfileId()
      const currentIndex = profiles.findIndex((p) => p.id === activeId)
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % profiles.length
      const ok = await profileManager.setActiveProfileId(profiles[nextIndex].id)
      if (!ok) {
        return
      }

      await onAuthChanged()
      await maybeRestartAfterProfileSwitch()
    },
  )

  const addFromCodexAuthFileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.addFromCodexAuthFile',
    async () => {
      const authPath = getDefaultCodexAuthPath()
      const loginCommandText = getLoginCommandText()
      const authData = await loadAuthDataFromFile(authPath)
      if (!authData) {
        vscode.window.showErrorMessage(
          vscode.l10n.t(
            'Could not read auth from {0}. Run "{1}" first.',
            authPath,
            loginCommandText,
          ),
        )
        return
      }

      const existing = await profileManager.findDuplicateProfile(authData)
      if (existing) {
        const replaceLabel = vscode.l10n.t('Replace')
        const pick = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'This account is already saved as profile "{0}". Replace it?',
            existing.name,
          ),
          { modal: true },
          replaceLabel,
        )
        if (pick !== replaceLabel) {
          return
        }

        await profileManager.replaceProfileAuth(existing.id, authData)
        await profileManager.setActiveProfileId(existing.id)
        await onAuthChanged()
        await maybeRestartAfterProfileSwitch()
        return
      }

      const defaultName =
        authData.email && authData.email !== 'Unknown'
          ? authData.email.split('@')[0]
          : 'profile'

      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t(
          'Profile name (for example "work" or "personal")',
        ),
        value: defaultName,
      })
      if (!name) {
        return
      }

      const profile = await profileManager.createProfile(name, authData)
      await profileManager.setActiveProfileId(profile.id)
      await onAuthChanged()
      await maybeRestartAfterProfileSwitch()
    },
  )

  const loginViaCliCommand = vscode.commands.registerCommand(
    'codex-switch.profile.login',
    async () => {
      const authPath = getDefaultCodexAuthPath()
      const loginSequence = `${getLoginCommandText()}\n`

      vscode.commands.executeCommand('workbench.action.terminal.new')
      setTimeout(() => {
        vscode.commands.executeCommand(
          'workbench.action.terminal.sendSequence',
          {
            text: loginSequence,
          },
        )
      }, 500)

      const start = Date.now()
      const maxWaitMs = 10 * 60 * 1000

      let watcher: fs.FSWatcher | undefined
      let done = false

      const cleanup = () => {
        if (done) {
          return
        }
        done = true
        if (watcher) {
          try {
            watcher.close()
          } catch {
            // ignore
          }
        }
      }

      const promptImport = async () => {
        cleanup()
        const importLabel = vscode.l10n.t('Import')
        const pick = await vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Codex auth file detected at {0}. Import it as a profile?',
            authPath,
          ),
          importLabel,
        )
        if (pick === importLabel) {
          await vscode.commands.executeCommand(
            'codex-switch.profile.addFromCodexAuthFile',
          )
        }
      }

      // Try to watch for auth.json being created/updated.
      try {
        const dir = path.dirname(authPath)
        if (fs.existsSync(dir)) {
          watcher = fs.watch(
            dir,
            { persistent: false },
            async (_event, filename) => {
              if (!filename) {
                return
              }
              if (String(filename).toLowerCase() !== 'auth.json') {
                return
              }
              if (Date.now() - start > maxWaitMs) {
                cleanup()
                return
              }
              if (fs.existsSync(authPath)) {
                await promptImport()
              }
            },
          )
        }
      } catch {
        // Best effort; fall back to manual import.
      }

      const importNowLabel = vscode.l10n.t('Import now')
      const manageLabel = vscode.l10n.t('Manage profiles')
      const msg = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          'After completing the login flow, import the current environment auth.json from {0} as a profile.',
          authPath,
        ),
        importNowLabel,
        manageLabel,
      )

      if (msg === importNowLabel) {
        cleanup()
        await vscode.commands.executeCommand(
          'codex-switch.profile.addFromCodexAuthFile',
        )
      } else if (msg === manageLabel) {
        cleanup()
        await vscode.commands.executeCommand('codex-switch.profile.manage')
      } else {
        // Let watcher run until it triggers or times out.
        setTimeout(() => cleanup(), maxWaitMs)
      }
    },
  )

  const addFromFileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.addFromFile',
    async () => {
      const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: vscode.l10n.t('Import auth.json'),
        filters: { JSON: ['json'] },
      })
      if (!uri || uri.length === 0) {
        return
      }

      const authData = await loadAuthDataFromFile(uri[0].fsPath)
      if (!authData) {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Selected file is not a valid auth.json.'),
        )
        return
      }

      const existing = await profileManager.findDuplicateProfile(authData)
      if (existing) {
        const replaceLabel = vscode.l10n.t('Replace')
        const pick = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'This account is already saved as profile "{0}". Replace it?',
            existing.name,
          ),
          { modal: true },
          replaceLabel,
        )
        if (pick !== replaceLabel) {
          return
        }

        await profileManager.replaceProfileAuth(existing.id, authData)
        await profileManager.setActiveProfileId(existing.id)
        await onAuthChanged()
        await maybeRestartAfterProfileSwitch()
        return
      }

      const defaultName =
        authData.email && authData.email !== 'Unknown'
          ? authData.email.split('@')[0]
          : 'profile'

      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Profile name'),
        value: defaultName,
      })
      if (!name) {
        return
      }

      const profile = await profileManager.createProfile(name, authData)
      await profileManager.setActiveProfileId(profile.id)
      await onAuthChanged()
      await maybeRestartAfterProfileSwitch()
    },
  )

  const exportSettingsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.exportSettings',
    async () => {
      const saveUri = await vscode.window.showSaveDialog({
        saveLabel: vscode.l10n.t('Export profiles'),
        defaultUri: getDefaultSettingsExportUri(),
        filters: { JSON: ['json'] },
      })
      if (!saveUri) {
        return
      }

      const { data, skipped } = await profileManager.exportProfilesForTransfer()
      fs.writeFileSync(saveUri.fsPath, JSON.stringify(data, null, 2), 'utf8')

      vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Exported {0} profile(s) to {1}. Skipped {2} profile(s) without tokens.',
          data.profiles.length,
          saveUri.fsPath,
          skipped,
        ),
      )
    },
  )

  const importSettingsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.importSettings',
    async () => {
      const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: vscode.l10n.t('Import profiles'),
        filters: { JSON: ['json'] },
      })
      if (!uri || uri.length === 0) {
        return
      }

      let payload: unknown
      try {
        payload = JSON.parse(fs.readFileSync(uri[0].fsPath, 'utf8')) as unknown
      } catch {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Selected file is not a valid JSON profiles export.'),
        )
        return
      }

      try {
        const result = await profileManager.importProfilesFromTransfer(payload)
        await onAuthChanged()
        await maybeRestartAfterProfileSwitch()
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Import completed: created {0}, updated {1}, skipped {2}.',
            result.created,
            result.updated,
            result.skipped,
          ),
        )
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : vscode.l10n.t('Unknown import error.')
        vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to import profiles: {0}', message),
        )
      }
    },
  )

  const renameProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.rename',
    async () => {
      const profiles = await profileManager.listProfiles()
      if (profiles.length === 0) {
        return
      }

      const pick = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: p.name,
          description: p.email && p.email !== 'Unknown' ? p.email : undefined,
          profileId: p.id,
        })),
        { placeHolder: vscode.l10n.t('Rename profile') },
      )
      if (!pick) {
        return
      }

      const newName = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('New profile name'),
        value: pick.label,
      })
      if (!newName) {
        return
      }

      await profileManager.renameProfile(pick.profileId, newName)
      await onAuthChanged()
    },
  )

  const deleteProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.delete',
    async () => {
      const profiles = await profileManager.listProfiles()
      if (profiles.length === 0) {
        return
      }

      const pick = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: p.name,
          description: p.email && p.email !== 'Unknown' ? p.email : undefined,
          profileId: p.id,
        })),
        { placeHolder: vscode.l10n.t('Delete profile') },
      )
      if (!pick) {
        return
      }

      const deleteLabel = vscode.l10n.t('Delete')
      const ok = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete profile "{0}"?', pick.label),
        { modal: true },
        deleteLabel,
      )
      if (ok !== deleteLabel) {
        return
      }

      await profileManager.deleteProfile(pick.profileId)
      await onAuthChanged()
    },
  )

  const manageProfilesCommand = vscode.commands.registerCommand(
    'codex-switch.profile.manage',
    async () => {
      const authPath = getDefaultCodexAuthPath()
      const profiles = await profileManager.listProfiles()
      const hasProfiles = profiles.length > 0

      const action = await vscode.window.showQuickPick(
        [
          {
            label: vscode.l10n.t('Login via Codex CLI...'),
            command: 'codex-switch.profile.login',
          },
          ...(hasProfiles
            ? [
                {
                  label: vscode.l10n.t('Switch profile'),
                  command: 'codex-switch.profile.switch',
                },
              ]
            : []),
          {
            label: vscode.l10n.t('Add from current auth.json'),
            description: authPath,
            command: 'codex-switch.profile.addFromCodexAuthFile',
          },
          {
            label: vscode.l10n.t('Import from file...'),
            command: 'codex-switch.profile.addFromFile',
          },
          {
            label: vscode.l10n.t('Export profiles...'),
            command: 'codex-switch.profile.exportSettings',
          },
          {
            label: vscode.l10n.t('Import profiles...'),
            command: 'codex-switch.profile.importSettings',
          },
          ...(hasProfiles
            ? [
                {
                  label: vscode.l10n.t('Rename profile'),
                  command: 'codex-switch.profile.rename',
                },
                {
                  label: vscode.l10n.t('Delete profile'),
                  command: 'codex-switch.profile.delete',
                },
              ]
            : []),
        ],
        { placeHolder: vscode.l10n.t('Manage profiles') },
      )
      if (!action) {
        return
      }
      await vscode.commands.executeCommand(action.command)
    },
  )

  // Register all commands
  context.subscriptions.push(loginCommand)
  context.subscriptions.push(loginViaCliCommand)
  context.subscriptions.push(switchProfileCommand)
  context.subscriptions.push(activateProfileCommand)
  context.subscriptions.push(toggleLastProfileCommand)
  context.subscriptions.push(manageProfilesCommand)
  context.subscriptions.push(addFromCodexAuthFileCommand)
  context.subscriptions.push(addFromFileCommand)
  context.subscriptions.push(exportSettingsCommand)
  context.subscriptions.push(importSettingsCommand)
  context.subscriptions.push(renameProfileCommand)
  context.subscriptions.push(deleteProfileCommand)
}
