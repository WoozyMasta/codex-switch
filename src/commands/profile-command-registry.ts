import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ProfileManager } from '../auth/profile-manager'
import { ProfileRateLimitService } from '../auth/profile-rate-limit-service'
import { loadAuthDataFromFile } from '../auth/auth-manager'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import { resolveCodexCliCommand } from '../utils/codex-cli-resolver'
import {
  resolveDefaultSettingsExportPath,
  resolveStatusBarClickBehavior,
} from '../utils/profile-command-options'
import { addCurrentAuthJsonAsProfile } from './profile-command-prompts'
import {
  addFromFile,
  exportProfiles,
  importProfiles,
} from './profile-file-command-handlers'
import { loginViaCli } from './profile-login-command-handlers'
import {
  activateProfileCommand as runActivateProfileCommand,
  loginCommand as runLoginCommand,
  switchProfileCommand as runSwitchProfileCommand,
  toggleLastProfileCommand as runToggleLastProfileCommand,
  type ProfileNavigationCommandDeps,
} from './profile-navigation-command-handlers'
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

  const navigationCommandDeps: ProfileNavigationCommandDeps = {
    promptDeps,
    profileManager,
    profileRateLimitService,
    maybeRestartAfterProfileSwitch,
    onAuthChanged,
    createQuickPick: vscode.window.createQuickPick,
    showInformationMessage: vscode.window.showInformationMessage,
    executeCommand: vscode.commands.executeCommand,
    translate: vscode.l10n.t,
    getLoginCommandText,
    createCodexTerminal:
      codexHomeManager.createCodexTerminal.bind(codexHomeManager),
    runtimeHome,
    writeClipboardText: (value: string) =>
      Promise.resolve(vscode.env.clipboard.writeText(value)),
    getStatusBarClickBehavior: () => {
      const raw = vscode.workspace
        .getConfiguration('codexSwitch')
        .get<
          'cycle' | 'toggleLast' | 'selector'
        >('statusBarClickBehavior', 'cycle')
      return resolveStatusBarClickBehavior(raw)
    },
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
    async () => runLoginCommand(navigationCommandDeps),
  )

  const switchProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.switch',
    async () => runSwitchProfileCommand(navigationCommandDeps),
  )

  const refreshRateLimitsCommand = vscode.commands.registerCommand(
    'codex-switch.profile.refresh',
    async () => runRefreshRateLimitsCommand(managementCommandDeps),
  )

  const activateProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.activate',
    async (profileId?: string) =>
      runActivateProfileCommand(navigationCommandDeps, profileId),
  )

  const toggleLastProfileCommand = vscode.commands.registerCommand(
    'codex-switch.profile.toggleLast',
    async () => runToggleLastProfileCommand(navigationCommandDeps),
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
