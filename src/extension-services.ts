import * as fs from 'fs'
import * as vscode from 'vscode'
import { ProfileManager } from './auth/profile-manager'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import { CodexHomeManager } from './codex-home/codex-home-manager'
import { ResolvedCodexHome } from './types'
import { resolveCodexCliCommand } from './utils/codex-cli-resolver'
import { debugLog } from './utils/log'

export interface ExtensionRuntimeContext {
  home: ResolvedCodexHome
}

export interface ExtensionServices {
  codexHomeManager: CodexHomeManager
  profileManager: ProfileManager
  profileRateLimitService: ProfileRateLimitService
  runtime: ExtensionRuntimeContext
}

export function createExtensionServices(
  context: vscode.ExtensionContext,
): ExtensionServices {
  const codexHomeManager = new CodexHomeManager({
    initialCodexHome: process.env.CODEX_HOME,
    codexHomeEnabled: vscode.workspace
      .getConfiguration('codexSwitch')
      .get<boolean>('codexHome.enabled', false),
    useWslAuthPath: vscode.workspace
      .getConfiguration('chatgpt')
      .get<boolean>('runCodexInWindowsSubsystemForLinux', false),
  })

  const profileManager = new ProfileManager(codexHomeManager, {
    fs,
    getConfiguration: vscode.workspace.getConfiguration,
    remoteName: vscode.env.remoteName,
    globalState: context.globalState,
    workspaceState: context.workspaceState,
    secrets: context.secrets,
    globalStorageUri: context.globalStorageUri,
    createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
    showErrorMessage: vscode.window.showErrorMessage,
    showInformationMessage: vscode.window.showInformationMessage,
    showWarningMessage: vscode.window.showWarningMessage,
    translate: vscode.l10n.t,
    createDisposable: (dispose) => new vscode.Disposable(dispose),
    uriFile: vscode.Uri.file,
    relativePattern: (base, pattern) =>
      new vscode.RelativePattern(base, pattern),
  })

  const profileRateLimitService = new ProfileRateLimitService(
    String(context.extension.packageJSON.version || 'unknown'),
    {
      debugLog,
      resolveCodexCliCommand,
    },
  )

  return {
    codexHomeManager,
    profileManager,
    profileRateLimitService,
    runtime: {
      home: codexHomeManager.getActiveHome(),
    },
  }
}
