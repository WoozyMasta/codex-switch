import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as vscode from 'vscode'
import { ProfileManager } from './auth/profile-manager'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import { ProfileMaintenanceService } from './auth/profile-maintenance-service'
import { CodexHomeManager } from './codex-home/codex-home-manager'
import { ResolvedCodexHome, StorageMode } from './types'
import { resolveCodexCliCommand } from './utils/codex-cli-resolver'
import { resolveStorageMode } from './utils/storage-mode'
import { getRateLimitAutoRefreshIntervalSeconds } from './utils/refresh-config'
import {
  buildMaintenancePaths,
  computeProductScopeHash,
} from './utils/profile-maintenance-paths'
import { debugLog } from './utils/log'

export interface ExtensionRuntimeContext {
  home: ResolvedCodexHome
}

export interface ExtensionServices {
  codexHomeManager: CodexHomeManager
  profileManager: ProfileManager
  profileRateLimitService: ProfileRateLimitService
  profileMaintenanceService: ProfileMaintenanceService
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

  const extensionVersion = String(
    context.extension.packageJSON.version || 'unknown',
  )

  const profileRateLimitService = new ProfileRateLimitService(
    extensionVersion,
    {
      debugLog,
      resolveCodexCliCommand,
    },
  )

  const profileMaintenanceService = createProfileMaintenanceService(
    context,
    profileManager,
    profileRateLimitService,
    extensionVersion,
  )

  return {
    codexHomeManager,
    profileManager,
    profileRateLimitService,
    profileMaintenanceService,
    runtime: {
      home: codexHomeManager.getActiveHome(),
    },
  }
}

function createProfileMaintenanceService(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileRateLimitService: ProfileRateLimitService,
  extensionVersion: string,
): ProfileMaintenanceService {
  const configuredStorageMode = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<StorageMode>('storageMode', 'auto')
  const profileStorageBackend = resolveStorageMode(
    configuredStorageMode === 'secretStorage' ||
      configuredStorageMode === 'remoteFiles' ||
      configuredStorageMode === 'auto'
      ? configuredStorageMode
      : 'auto',
    vscode.env.remoteName,
  )

  const scopeHash = computeProductScopeHash({
    appName: vscode.env.appName,
    uriScheme: vscode.env.uriScheme,
    remoteName: vscode.env.remoteName,
    globalStorageFsPath: context.globalStorageUri.fsPath,
    profileStorageBackend,
  })

  return new ProfileMaintenanceService({
    paths: buildMaintenancePaths(scopeHash),
    diagnostics: {
      pid: process.pid,
      sessionId: vscode.env.sessionId,
      appName: vscode.env.appName,
      uriScheme: vscode.env.uriScheme,
      ideVersion: vscode.version,
      extensionVersion,
    },
    fs: fsPromises,
    profileManager,
    runProfileMaintenance: (manager, profile) =>
      profileRateLimitService.runProfileMaintenance(manager, profile),
    getIntervalSeconds: getRateLimitAutoRefreshIntervalSeconds,
    debugLog,
  })
}
