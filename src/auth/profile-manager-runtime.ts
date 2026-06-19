import type * as vscode from 'vscode'
import { StorageMode } from '../types'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import { loadAuthDataFromFile } from './auth-manager'
import { buildCodexAuthJson, syncCodexAuthFile } from './codex-auth-sync'
import { resolveStorageMode } from '../utils/storage-mode'
import { ProfileAuthFileService } from './profile-auth-file-service'
import { ProfileAuthRecoveryService } from './profile-auth-recovery-service'
import { ProfileAuthSyncService } from './profile-auth-sync-service'
import { ProfileStateService } from './profile-state-service'
import { ProfileStorageService } from './profile-storage-service'
import { ProfileTransferService } from './profile-transfer-service'
import { sha256Text } from '../utils/text-hash'
import type {
  ConfigurationGetter,
  SecretStorageStore,
  StateStore,
  SyncFileSystem,
} from './runtime-adapters'

export interface ProfileManagerDeps {
  fs: SyncFileSystem
  getConfiguration: ConfigurationGetter
  remoteName: string | undefined
  globalState: StateStore
  workspaceState: StateStore
  secrets: SecretStorageStore
  globalStorageUri: vscode.Uri
  createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher
  showErrorMessage: typeof vscode.window.showErrorMessage
  showInformationMessage: typeof vscode.window.showInformationMessage
  showWarningMessage: typeof vscode.window.showWarningMessage
  translate: typeof vscode.l10n.t
  createDisposable: (dispose: () => void) => vscode.Disposable
  uriFile: (path: string) => vscode.Uri
  relativePattern: (base: vscode.Uri, pattern: string) => vscode.RelativePattern
}

export class ProfileManagerRuntime {
  constructor(
    private readonly codexHomeManager: CodexHomeManager,
    deps: ProfileManagerDeps,
  ) {
    this.fs = deps.fs
    this.getConfiguration = deps.getConfiguration
    this.remoteName = deps.remoteName
    this.globalState = deps.globalState
    this.workspaceState = deps.workspaceState
    this.secrets = deps.secrets
    this.globalStorageUri = deps.globalStorageUri
    this.createFileSystemWatcher = deps.createFileSystemWatcher
    this.showErrorMessage = deps.showErrorMessage
    this.showInformationMessage = deps.showInformationMessage
    this.showWarningMessage = deps.showWarningMessage
    this.translate = deps.translate
    this.createDisposable = deps.createDisposable
    this.uriFile = deps.uriFile
    this.relativePattern = deps.relativePattern
    this.profileStorageService = new ProfileStorageService({
      fs: this.fs,
      globalState: this.globalState,
      workspaceState: this.workspaceState,
      secrets: this.secrets,
      globalStorageUri: this.globalStorageUri,
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
      getActiveCodexHome: () => this.getActiveCodexHome(),
      showErrorMessage: this.showErrorMessage,
      showInformationMessage: this.showInformationMessage,
      translate: this.translate,
    })
    this.profileAuthFileService = new ProfileAuthFileService({
      fs: this.fs,
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      loadLiveCodexAuthData: () =>
        loadAuthDataFromFile(this.getActiveCodexAuthPath()),
      buildCodexAuthJson,
      syncCodexAuthFile,
      sha256Text,
      listProfiles: () => this.profileStorageService.listProfiles(),
      loadAuthData: (profileId) =>
        this.profileStorageService.loadAuthData(profileId),
      replaceProfileAuth: (profileId, authData) =>
        this.profileStorageService.replaceProfileAuth(profileId, authData),
    })
    this.profileTransferService = new ProfileTransferService({
      listProfiles: () => this.profileStorageService.listProfiles(),
      getActiveProfileId: () => this.profileStateService.getActiveProfileId(),
      getLastProfileId: () => this.profileStateService.getLastProfileId(),
      readStoredTokens: (profileId) =>
        this.profileStorageService.readStoredTokens(profileId),
      findDuplicateProfile: (authData) =>
        this.profileStorageService.findDuplicateProfile(authData),
      replaceProfileAuth: (profileId, authData) =>
        this.profileStorageService.replaceProfileAuth(profileId, authData),
      createProfile: (name, authData) =>
        this.profileStorageService.createProfile(name, authData),
      setActiveProfileId: (profileId) =>
        this.profileStateService.setActiveProfileId(profileId),
      setLastProfileId: (profileId) =>
        this.profileStateService.setLastProfileId(profileId),
    })
    this.profileAuthSyncService = new ProfileAuthSyncService({
      getActiveProfileId: () => this.profileStateService.getActiveProfileId(),
      getProfile: (profileId) =>
        this.profileStorageService.getProfile(profileId),
      loadAuthData: (profileId) =>
        this.profileStorageService.loadAuthData(profileId),
      loadLiveCodexAuthData: () =>
        this.profileAuthFileService.loadLiveCodexAuthData(),
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      setLastProfileId: (profileId) =>
        this.profileStateService.setLastProfileId(profileId),
      setActiveProfileIdInState: (profileId) =>
        this.profileStateService.setActiveProfileIdInState(profileId),
      syncActiveProfileToCodexAuthFile: () =>
        this.syncActiveProfileToCodexAuthFile(),
      captureLiveAuthForMatchingProfile: (authPath) =>
        this.profileAuthFileService.captureLiveAuthForMatchingProfile(authPath),
      listProfiles: () => this.profileStorageService.listProfiles(),
      replaceProfileAuth: (profileId, authData) =>
        this.profileStorageService.replaceProfileAuth(profileId, authData),
      createFileSystemWatcher: this.createFileSystemWatcher,
      uriFile: this.uriFile,
      relativePattern: this.relativePattern,
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
    })
    this.profileAuthRecoveryService = new ProfileAuthRecoveryService({
      getActiveProfileId: () => this.profileStateService.getActiveProfileId(),
      getProfile: (profileId) =>
        this.profileStorageService.getProfile(profileId),
      listProfiles: () => this.profileStorageService.listProfiles(),
      loadAuthData: (profileId) =>
        this.profileStorageService.loadAuthData(profileId),
      loadLiveCodexAuthData: () =>
        this.profileAuthFileService.loadLiveCodexAuthData(),
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      replaceProfileAuth: (profileId, authData) =>
        this.profileStorageService.replaceProfileAuth(profileId, authData),
      deleteProfile: (profileId) =>
        this.profileStorageService.deleteProfile(profileId),
      readRemoteProfileTokens: (profileId) =>
        this.profileStorageService.readRemoteProfileTokens(profileId),
      writeStoredTokens: (profileId, tokens) =>
        this.profileStorageService.writeStoredTokens(profileId, tokens),
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
      showWarningMessage: deps.showWarningMessage,
      showErrorMessage: this.showErrorMessage,
      translate: this.translate,
    })
    this.profileStateService = new ProfileStateService({
      getActiveCodexHome: () => this.getActiveCodexHome(),
      getConfiguration: this.getConfiguration,
      globalState: this.globalState,
      workspaceState: this.workspaceState,
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
      getProfile: (profileId) =>
        this.profileStorageService.getProfile(profileId),
      loadAuthData: (profileId) =>
        this.profileStorageService.loadAuthData(profileId),
      loadLiveCodexAuthData: () =>
        this.profileAuthFileService.loadLiveCodexAuthData(),
      inferActiveProfileIdFromAuthFile: () =>
        this.profileAuthFileService.inferActiveProfileIdFromAuthFile(),
      recoverMissingTokens: (profileId) =>
        this.profileAuthRecoveryService.recoverMissingTokens(profileId),
      preserveStoredProfileAuthFromLive: (profileId) =>
        this.profileAuthRecoveryService.preserveStoredProfileAuthFromLive(
          profileId,
        ),
      syncProfileAuthToCodexAuthFile: (profileId, authData) =>
        this.profileAuthFileService.syncProfileAuthToCodexAuthFile(
          profileId,
          authData,
        ),
      resetSyncCache: () => this.profileAuthFileService.resetSyncCache(),
      readSharedActiveProfile: () =>
        this.profileStorageService.readSharedActiveProfile()?.profileId,
      readDefaultHomeSharedActiveProfileId: () =>
        this.profileStorageService.readDefaultHomeSharedActiveProfileId(),
      readDefaultHomeSharedLegacyActiveProfileId: () =>
        this.profileStorageService.readDefaultHomeSharedLegacyActiveProfileId(),
      writeSharedActiveProfile: (profileId) =>
        this.profileStorageService.writeSharedActiveProfile(profileId),
      deleteSharedActiveProfile: () =>
        this.profileStorageService.deleteSharedActiveProfile(),
      hasActiveCodexAuthFile: () =>
        this.profileAuthFileService.hasActiveCodexAuthFile(),
      deleteActiveCodexAuthFile: () =>
        this.profileAuthFileService.deleteActiveCodexAuthFile(),
    })
  }

  public readonly fs: SyncFileSystem
  public readonly getConfiguration: ConfigurationGetter
  public readonly remoteName: string | undefined
  public readonly globalState: StateStore
  public readonly workspaceState: StateStore
  public readonly secrets: SecretStorageStore
  public readonly globalStorageUri: vscode.Uri
  public readonly createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher
  public readonly showErrorMessage: typeof vscode.window.showErrorMessage
  public readonly showInformationMessage: typeof vscode.window.showInformationMessage
  public readonly showWarningMessage: typeof vscode.window.showWarningMessage
  public readonly translate: typeof vscode.l10n.t
  public readonly createDisposable: (dispose: () => void) => vscode.Disposable
  public readonly uriFile: (path: string) => vscode.Uri
  public readonly relativePattern: (
    base: vscode.Uri,
    pattern: string,
  ) => vscode.RelativePattern
  public readonly profileStorageService: ProfileStorageService
  public readonly profileAuthFileService: ProfileAuthFileService
  public readonly profileTransferService: ProfileTransferService
  public readonly profileAuthSyncService: ProfileAuthSyncService
  public readonly profileAuthRecoveryService: ProfileAuthRecoveryService
  public readonly profileStateService: ProfileStateService

  private getConfiguredStorageMode(): StorageMode {
    const cfg = this.getConfiguration('codexSwitch')
    const raw = cfg.get<StorageMode>('storageMode', 'auto')
    if (raw === 'secretStorage' || raw === 'remoteFiles' || raw === 'auto') {
      return raw
    }
    return 'auto'
  }

  private getResolvedStorageMode(): Exclude<StorageMode, 'auto'> {
    return resolveStorageMode(this.getConfiguredStorageMode(), this.remoteName)
  }

  private isRemoteFilesMode(): boolean {
    return this.getResolvedStorageMode() === 'remoteFiles'
  }

  private getActiveCodexHome() {
    return this.codexHomeManager.getActiveHome()
  }

  getActiveCodexAuthPath(): string {
    return this.getActiveCodexHome().authPath
  }

  getActiveCodexHomeSummary() {
    return this.getActiveCodexHome()
  }

  private async syncActiveProfileToCodexAuthFile(): Promise<void> {
    const active = await this.profileStateService.getActiveProfileId()
    if (!active) {
      return
    }
    await this.profileAuthFileService.syncActiveProfileToCodexAuthFile(active)
  }
}
