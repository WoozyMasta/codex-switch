import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ProfileManager } from '../auth/profile-manager'
import { ProfileRateLimitService } from '../auth/profile-rate-limit-service'
import { loadAuthDataFromFile } from '../auth/auth-manager'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import { buildProfileMetaDisplay } from '../ui/profile-display'
import { resolveCodexCliCommand } from '../utils/codex-cli-resolver'
import {
  resolveDefaultSettingsExportPath,
  resolveStatusBarClickBehavior,
  type StatusBarClickBehavior,
} from '../utils/profile-command-options'
import {
  buildProfileSwitchQuickPickItems,
  type ProfileQuickPickItem,
} from '../utils/profile-quick-pick'
import {
  addCurrentAuthJsonAsProfile,
  ensureLiveAuthIsSavedBeforeReplacing,
} from './profile-command-prompts'
import {
  addFromFile,
  exportProfiles,
  importProfiles,
} from './profile-file-command-handlers'
import { loginViaCli } from './profile-login-command-handlers'
import {
  deleteProfileCommand as runDeleteProfileCommand,
  manageProfilesCommand as runManageProfilesCommand,
  prepareForNewLoginChatCommand as runPrepareForNewLoginChatCommand,
  refreshRateLimitsCommand as runRefreshRateLimitsCommand,
  renameProfileCommand as runRenameProfileCommand,
  syncFromDefaultHomeCommand as runSyncFromDefaultHomeCommand,
  type ProfileManagementCommandDeps,
} from './profile-management-command-handlers'
import { restartExtensionHostOrReloadWindow } from '../utils/vscode-restart'
import { ResolvedCodexHome } from '../types'

/**
 * Register all extension commands
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  codexHomeManager: CodexHomeManager,
  runtimeHome: ResolvedCodexHome,
  profileRateLimitService: ProfileRateLimitService,
  onAuthChanged: (options?: {
    forceRateLimitRefresh?: boolean
  }) => Promise<void>,
) {
  const maybeRestartAfterProfileSwitch = async () => {
    const reloadAfterSwitch = vscode.workspace
      .getConfiguration('codexSwitch')
      .get<boolean>('reloadWindowAfterProfileSwitch', false)
    if (!reloadAfterSwitch) {
      return
    }

    await restartExtensionHostOrReloadWindow()
  }

  const reloadAfterAuthReset = async (): Promise<void> => {
    await restartExtensionHostOrReloadWindow()
  }

  const getLoginCommandText = (): string =>
    codexHomeManager.buildLoginCommand(runtimeHome)

  const getStatusBarClickBehavior = (): StatusBarClickBehavior => {
    const raw = vscode.workspace
      .getConfiguration('codexSwitch')
      .get<StatusBarClickBehavior>('statusBarClickBehavior', 'cycle')
    return resolveStatusBarClickBehavior(raw)
  }

  const getDefaultSettingsExportUri = (): vscode.Uri => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return vscode.Uri.file(
      resolveDefaultSettingsExportPath(workspacePath, os.homedir()),
    )
  }

  const promptDeps = {
    getActiveCodexAuthPath: () => profileManager.getActiveCodexAuthPath(),
    getLoginCommandText,
    loadAuthDataFromFile,
    findDuplicateProfile: (
      authData: Parameters<ProfileManager['findDuplicateProfile']>[0],
    ) => profileManager.findDuplicateProfile(authData),
    replaceProfileAuth: (
      profileId: string,
      authData: Parameters<ProfileManager['replaceProfileAuth']>[1],
    ) => profileManager.replaceProfileAuth(profileId, authData),
    createProfile: (
      name: string,
      authData: Parameters<ProfileManager['createProfile']>[1],
    ) => profileManager.createProfile(name, authData),
    setActiveProfileId: (profileId: string) =>
      profileManager.setActiveProfileId(profileId),
    preserveLiveAuthForMatchingProfile: () =>
      profileManager.preserveLiveAuthForMatchingProfile(),
    updateCodexCliPath: async (codexCliPath: string) => {
      await vscode.workspace
        .getConfiguration('codexSwitch')
        .update('codexCliPath', codexCliPath, vscode.ConfigurationTarget.Global)
    },
    hasCodexCli: () => Boolean(resolveCodexCliCommand()),
    executeCommand: vscode.commands.executeCommand,
    showErrorMessage: vscode.window.showErrorMessage,
    showInformationMessage: vscode.window.showInformationMessage,
    showWarningMessage: vscode.window.showWarningMessage,
    showInputBox: vscode.window.showInputBox,
    showOpenDialog: vscode.window.showOpenDialog,
    translate: vscode.l10n.t,
    restartAfterImport: maybeRestartAfterProfileSwitch,
    onAuthChanged,
  }

  const fileCommandDeps = {
    promptDeps,
    getDefaultSettingsExportUri: () => getDefaultSettingsExportUri(),
    exportProfilesForTransfer: () => profileManager.exportProfilesForTransfer(),
    importProfilesFromTransfer: (value: unknown) =>
      profileManager.importProfilesFromTransfer(value),
    showOpenDialog: vscode.window.showOpenDialog,
    showSaveDialog: vscode.window.showSaveDialog,
    showWarningMessage: vscode.window.showWarningMessage,
    showErrorMessage: vscode.window.showErrorMessage,
    showInformationMessage: vscode.window.showInformationMessage,
    translate: vscode.l10n.t,
    pathExists: fs.existsSync,
    readFileText: (filePath: string) => fs.readFileSync(filePath, 'utf8'),
    maybeRestartAfterProfileSwitch,
    onAuthChanged,
  }

  const loginViaCliDeps = {
    promptDeps,
    getActiveCodexAuthPath: () => profileManager.getActiveCodexAuthPath(),
    getLoginCommandText,
    createCodexTerminal:
      codexHomeManager.createCodexTerminal.bind(codexHomeManager),
    runtimeHome,
    executeCommand: vscode.commands.executeCommand,
    showInformationMessage: vscode.window.showInformationMessage,
    translate: vscode.l10n.t,
    fsExistsSync: fs.existsSync,
    fsWatch: fs.watch,
    dirname: path.dirname,
    scheduleCleanup: setTimeout,
  }

  const managementCommandDeps: ProfileManagementCommandDeps = {
    promptDeps,
    profileManager,
    maybeRestartAfterProfileSwitch,
    reloadAfterAuthReset,
    onAuthChanged,
    showQuickPick: vscode.window.showQuickPick,
    showInputBox: vscode.window.showInputBox,
    showWarningMessage: vscode.window.showWarningMessage,
    showInformationMessage: vscode.window.showInformationMessage,
    showErrorMessage: vscode.window.showErrorMessage,
    executeCommand: vscode.commands.executeCommand,
    translate: vscode.l10n.t,
    buildManageProfilesLabels: () => ({
      prepareForNewLogin: vscode.l10n.t('Prepare for New Login (Chat)'),
      loginViaCodexCli: vscode.l10n.t('Login via Codex CLI...'),
      switchProfile: vscode.l10n.t('Switch profile'),
      addFromCurrentAuthJson: vscode.l10n.t('Add from current auth.json'),
      importFromFile: vscode.l10n.t('Import from file...'),
      exportProfiles: vscode.l10n.t('Export profiles...'),
      importProfiles: vscode.l10n.t('Import profiles...'),
      useDefaultProfileHere: vscode.l10n.t(
        'Use default CODEX_HOME profile here',
      ),
      renameProfile: vscode.l10n.t('Rename profile'),
      deleteProfile: vscode.l10n.t('Delete profile'),
    }),
  }

  // Login command
  const loginCommand = vscode.commands.registerCommand(
    'codex-switch.login',
    async () => {
      const loginCommandText = getLoginCommandText()
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
        const terminal = codexHomeManager.createCodexTerminal(
          undefined,
          runtimeHome,
        )
        terminal.show()
        terminal.sendText(loginCommandText)
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
      const rawProfiles = await profileManager.listProfiles()
      if (rawProfiles.length === 0) {
        await vscode.commands.executeCommand('codex-switch.profile.manage')
        return
      }

      const activeId = await profileManager.getActiveProfileId()

      const quickPick = vscode.window.createQuickPick<ProfileQuickPickItem>()
      quickPick.placeholder = vscode.l10n.t('Switch profile')
      quickPick.items = buildProfileSwitchQuickPickItems(
        profileRateLimitService.applyCachedRateLimits(rawProfiles),
        activeId,
        vscode.l10n.t('Active'),
        (profile) =>
          buildProfileMetaDisplay(profile.planType, profile.rateLimits),
      )
      quickPick.busy = true

      let disposed = false
      let pickedProfileId: string | undefined
      const pickPromise = new Promise<string | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
          pickedProfileId = quickPick.selectedItems[0]?.profileId
          quickPick.hide()
        })
        quickPick.onDidHide(() => {
          disposed = true
          quickPick.dispose()
          resolve(pickedProfileId)
        })
      })

      quickPick.show()

      void profileRateLimitService
        .decorateProfiles(profileManager, rawProfiles)
        .then((profiles) => {
          if (!disposed) {
            quickPick.items = buildProfileSwitchQuickPickItems(
              profiles,
              activeId,
              vscode.l10n.t('Active'),
              (profile) =>
                buildProfileMetaDisplay(profile.planType, profile.rateLimits),
            )
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!disposed) {
            quickPick.busy = false
          }
        })

      const profileId = await pickPromise
      if (!profileId) {
        return
      }
      const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
        promptDeps,
        vscode.l10n.t('switch profiles'),
      )
      if (!canReplaceLiveAuth) {
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

  const refreshRateLimitsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.refresh',
    async () => runRefreshRateLimitsCommand(managementCommandDeps),
  )

  const activateProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.activate',
    async (profileId?: string) => {
      if (!profileId) {
        await vscode.commands.executeCommand('codex-switch.profile.switch')
        return
      }

      const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
        promptDeps,
        vscode.l10n.t('switch profiles'),
      )
      if (!canReplaceLiveAuth) {
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
      if (behavior === 'selector') {
        await vscode.commands.executeCommand('codex-switch.profile.switch')
        return
      }

      if (behavior === 'toggleLast') {
        const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
          promptDeps,
          vscode.l10n.t('switch profiles'),
        )
        if (!canReplaceLiveAuth) {
          return
        }

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
      const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
        promptDeps,
        vscode.l10n.t('switch profiles'),
      )
      if (!canReplaceLiveAuth) {
        return
      }
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
    async (): Promise<boolean> => addCurrentAuthJsonAsProfile(promptDeps, true),
  )

  const prepareForNewLoginChatCommand = vscode.commands.registerCommand(
    'codex-switch.profile.prepareForNewLoginChat',
    async () => runPrepareForNewLoginChatCommand(managementCommandDeps),
  )

  const loginViaCliCommand = vscode.commands.registerCommand(
    'codex-switch.profile.login',
    async () => loginViaCli(loginViaCliDeps),
  )

  const addFromFileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.addFromFile',
    async () => addFromFile(fileCommandDeps),
  )

  const exportSettingsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.exportSettings',
    async () => exportProfiles(fileCommandDeps),
  )

  const importSettingsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.importSettings',
    async () => importProfiles(fileCommandDeps),
  )

  const renameProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.rename',
    async () => runRenameProfileCommand(managementCommandDeps),
  )

  const deleteProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.delete',
    async () => runDeleteProfileCommand(managementCommandDeps),
  )

  const syncFromDefaultHomeCommand = vscode.commands.registerCommand(
    'codex-switch.profile.syncFromDefaultHome',
    async () => runSyncFromDefaultHomeCommand(managementCommandDeps),
  )

  const manageProfilesCommand = vscode.commands.registerCommand(
    'codex-switch.profile.manage',
    async () => runManageProfilesCommand(managementCommandDeps),
  )

  // Register all commands
  context.subscriptions.push(loginCommand)
  context.subscriptions.push(loginViaCliCommand)
  context.subscriptions.push(refreshRateLimitsCommand)
  context.subscriptions.push(switchProfileCommand)
  context.subscriptions.push(activateProfileCommand)
  context.subscriptions.push(toggleLastProfileCommand)
  context.subscriptions.push(manageProfilesCommand)
  context.subscriptions.push(addFromCodexAuthFileCommand)
  context.subscriptions.push(prepareForNewLoginChatCommand)
  context.subscriptions.push(addFromFileCommand)
  context.subscriptions.push(exportSettingsCommand)
  context.subscriptions.push(importSettingsCommand)
  context.subscriptions.push(renameProfileCommand)
  context.subscriptions.push(deleteProfileCommand)
  context.subscriptions.push(syncFromDefaultHomeCommand)
}
