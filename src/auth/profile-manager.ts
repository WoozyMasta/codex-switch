import type * as vscode from 'vscode'
import * as fs from 'fs'
import { AuthData, ProfileSummary, StorageMode } from '../types'
import { loadAuthDataFromFile } from './auth-manager'
import { buildCodexAuthJson, syncCodexAuthFile } from './codex-auth-sync'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from '../utils/auth-identity'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import { resolveStorageMode } from '../utils/storage-mode'
import {
  captureLiveAuthForMatchingProfile,
  maybeSyncProfileAuthToCodexAuthFile,
} from '../utils/profile-live-auth-sync'
import { sha256Text } from '../utils/text-hash'
import {
  ProfileTransferService,
  type ExportedSettingsV1,
  type ImportProfilesResult,
} from './profile-transfer-service'
import { ProfileAuthSyncService } from './profile-auth-sync-service'
import { ProfileAuthRecoveryService } from './profile-auth-recovery-service'
import { ProfileStateService } from './profile-state-service'
import { ProfileStorageService } from './profile-storage-service'

// Backward compatibility keys (pre-rename).
interface LiveAuthPreservationResult {
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

interface PrepareForNewLoginChatResult {
  removedAuthFile: boolean
}

interface ProfileManagerDeps {
  fs: typeof fs
  getConfiguration: typeof vscode.workspace.getConfiguration
  remoteName: string | undefined
  globalState: vscode.Memento
  workspaceState: vscode.Memento
  secrets: vscode.SecretStorage
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

export class ProfileManager {
  constructor(
    private codexHomeManager: CodexHomeManager,
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
    this.profileTransferService = new ProfileTransferService({
      listProfiles: () => this.profileStorageService.listProfiles(),
      getActiveProfileId: () => this.getActiveProfileId(),
      getLastProfileId: () => this.getLastProfileId(),
      readStoredTokens: (profileId) =>
        this.profileStorageService.readStoredTokens(profileId),
      findDuplicateProfile: (authData) => this.findDuplicateProfile(authData),
      replaceProfileAuth: (profileId, authData) =>
        this.replaceProfileAuth(profileId, authData),
      createProfile: (name, authData) => this.createProfile(name, authData),
      setActiveProfileId: (profileId) => this.setActiveProfileId(profileId),
      setLastProfileId: (profileId) => this.setLastProfileId(profileId),
    })
    this.profileAuthSyncService = new ProfileAuthSyncService({
      getActiveProfileId: () => this.getActiveProfileId(),
      getProfile: (profileId) => this.getProfile(profileId),
      loadAuthData: (profileId) => this.loadAuthData(profileId),
      loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      setLastProfileId: (profileId) =>
        this.profileStateService.setLastProfileId(profileId),
      setActiveProfileIdInState: (profileId) =>
        this.profileStateService.setActiveProfileIdInState(profileId),
      syncActiveProfileToCodexAuthFile: () =>
        this.syncActiveProfileToCodexAuthFile(),
      captureLiveAuthForMatchingProfile: (authPath) =>
        this.captureLiveAuthForMatchingProfile(authPath),
      listProfiles: () => this.profileStorageService.listProfiles(),
      replaceProfileAuth: (profileId, authData) =>
        this.replaceProfileAuth(profileId, authData),
      createFileSystemWatcher: this.createFileSystemWatcher,
      uriFile: this.uriFile,
      relativePattern: this.relativePattern,
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
    })
    this.profileAuthRecoveryService = new ProfileAuthRecoveryService({
      getActiveProfileId: () => this.getActiveProfileId(),
      getProfile: (profileId) => this.getProfile(profileId),
      listProfiles: () => this.profileStorageService.listProfiles(),
      loadAuthData: (profileId) => this.loadAuthData(profileId),
      loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      replaceProfileAuth: (profileId, authData) =>
        this.replaceProfileAuth(profileId, authData),
      deleteProfile: (profileId) => this.deleteProfile(profileId),
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
      getProfile: (profileId) => this.getProfile(profileId),
      loadAuthData: (profileId) => this.loadAuthData(profileId),
      loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
      inferActiveProfileIdFromAuthFile: () =>
        this.profileStorageService.inferActiveProfileIdFromAuthFile(
          this.getActiveCodexAuthPath(),
        ),
      recoverMissingTokens: (profileId) =>
        this.profileAuthRecoveryService.recoverMissingTokens(profileId),
      preserveStoredProfileAuthFromLive: (profileId) =>
        this.profileAuthRecoveryService.preserveStoredProfileAuthFromLive(
          profileId,
        ),
      syncProfileAuthToCodexAuthFile: (profileId, authData) =>
        this.syncProfileAuthToCodexAuthFile(profileId, authData),
      resetSyncCache: () => {
        this.lastSyncedProfileId = undefined
        this.lastSyncedAuthHash = undefined
      },
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
        this.fs.existsSync(this.getActiveCodexAuthPath()),
      deleteActiveCodexAuthFile: () => {
        if (this.fs.existsSync(this.getActiveCodexAuthPath())) {
          this.fs.unlinkSync(this.getActiveCodexAuthPath())
        }
      },
    })
  }

  private lastSyncedProfileId: string | undefined
  private lastSyncedAuthHash: string | undefined
  private readonly fs: typeof fs
  private readonly getConfiguration: typeof vscode.workspace.getConfiguration
  private readonly remoteName: string | undefined
  private readonly globalState: vscode.Memento
  private readonly workspaceState: vscode.Memento
  private readonly secrets: vscode.SecretStorage
  private readonly globalStorageUri: vscode.Uri
  private readonly createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher
  private readonly showErrorMessage: typeof vscode.window.showErrorMessage
  private readonly showInformationMessage: typeof vscode.window.showInformationMessage
  private readonly translate: typeof vscode.l10n.t
  private readonly createDisposable: (dispose: () => void) => vscode.Disposable
  private readonly uriFile: (path: string) => vscode.Uri
  private readonly relativePattern: (
    base: vscode.Uri,
    pattern: string,
  ) => vscode.RelativePattern
  private readonly profileStorageService: ProfileStorageService
  private readonly profileTransferService: ProfileTransferService
  private readonly profileAuthSyncService: ProfileAuthSyncService
  private readonly profileAuthRecoveryService: ProfileAuthRecoveryService
  private readonly profileStateService: ProfileStateService

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

  private matchesAuth(profile: ProfileSummary, authData: AuthData): boolean {
    return (
      compareIdentitySnapshots(
        buildIdentitySnapshot(profile),
        buildIdentitySnapshot(authData),
      ) === 'exact'
    )
  }

  private async loadLiveCodexAuthData(): Promise<AuthData | null> {
    return loadAuthDataFromFile(this.getActiveCodexAuthPath())
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

  private readAuthFileHash(authPath: string): string | undefined {
    try {
      if (!this.fs.existsSync(authPath)) {
        return undefined
      }
      const content = this.fs.readFileSync(authPath, 'utf8')
      return sha256Text(content)
    } catch {
      return undefined
    }
  }

  private syncProfileAuthToCodexAuthFile(
    profileId: string,
    authData: AuthData,
  ): void {
    const content = buildCodexAuthJson(authData)
    syncCodexAuthFile(this.getActiveCodexAuthPath(), authData)
    this.lastSyncedProfileId = profileId
    this.lastSyncedAuthHash = sha256Text(content)
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    return this.profileStorageService.listProfiles()
  }

  async getProfile(profileId: string): Promise<ProfileSummary | undefined> {
    return this.profileStorageService.getProfile(profileId)
  }

  async exportProfilesForTransfer(): Promise<{
    data: ExportedSettingsV1
    skipped: number
  }> {
    return this.profileTransferService.exportProfilesForTransfer()
  }

  async importProfilesFromTransfer(
    value: unknown,
  ): Promise<ImportProfilesResult> {
    return this.profileTransferService.importProfilesFromTransfer(value)
  }

  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    return this.profileStorageService.findDuplicateProfile(authData)
  }

  async replaceProfileAuth(
    profileId: string,
    authData: AuthData,
  ): Promise<boolean> {
    return this.profileStorageService.replaceProfileAuth(profileId, authData)
  }

  async createProfile(
    name: string,
    authData: AuthData,
  ): Promise<ProfileSummary> {
    return this.profileStorageService.createProfile(name, authData)
  }

  async renameProfile(profileId: string, newName: string): Promise<boolean> {
    return this.profileStorageService.renameProfile(profileId, newName)
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    return this.profileStorageService.deleteProfile(profileId)
  }

  private async captureLiveAuthForMatchingProfile(
    authPath: string,
  ): Promise<void> {
    await captureLiveAuthForMatchingProfile(
      {
        lastSyncedAuthHash: this.lastSyncedAuthHash,
        readAuthFileHash: (value) => this.readAuthFileHash(value),
        loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
        findProfileByPreservationIdentity: (liveAuth, preferredProfileId) =>
          findProfileByPreservationIdentity(
            {
              listProfiles: () => this.listProfiles(),
              loadAuthData: (profileId) => this.loadAuthData(profileId),
            },
            liveAuth,
            preferredProfileId,
          ),
        maybeReplaceProfileAuthWithLive: (profile, liveAuth) =>
          maybeReplaceProfileAuthWithLive(
            {
              loadAuthData: (profileId) => this.loadAuthData(profileId),
              replaceProfileAuth: (profileId, authData) =>
                this.replaceProfileAuth(profileId, authData),
            },
            profile,
            liveAuth,
          ),
      },
      authPath,
    )
  }

  async loadAuthData(profileId: string): Promise<AuthData | null> {
    return this.profileStorageService.loadAuthData(profileId)
  }

  async getActiveProfileId(): Promise<string | undefined> {
    return this.profileStateService.getActiveProfileId()
  }

  async prepareForNewLoginChat(): Promise<PrepareForNewLoginChatResult> {
    return this.profileStateService.prepareForNewLoginChat()
  }

  async setActiveProfileId(profileId: string | undefined): Promise<boolean> {
    return this.profileStateService.setActiveProfileId(profileId)
  }

  async syncActiveProfileFromDefaultHome(): Promise<string | undefined> {
    return this.profileStateService.syncActiveProfileFromDefaultHome()
  }

  async getLastProfileId(): Promise<string | undefined> {
    return this.profileStateService.getLastProfileId()
  }

  async setLastProfileId(profileId: string | undefined): Promise<void> {
    return this.profileStateService.setLastProfileId(profileId)
  }

  async toggleLastProfileId(): Promise<string | undefined> {
    return this.profileStateService.toggleLastProfileId()
  }

  async reconcileActiveProfileWithCodexAuthFile(): Promise<void> {
    await this.profileAuthSyncService.reconcileActiveProfileWithCodexAuthFile()
  }

  async preserveLiveAuthForMatchingProfile(): Promise<LiveAuthPreservationResult> {
    return this.profileAuthRecoveryService.preserveLiveAuthForMatchingProfile()
  }

  async syncActiveProfileToCodexAuthFile(): Promise<void> {
    const active = await this.getActiveProfileId()
    if (!active) {
      return
    }
    await maybeSyncProfileAuthToCodexAuthFile(
      {
        lastSyncedProfileId: this.lastSyncedProfileId,
        loadAuthData: (profileId) => this.loadAuthData(profileId),
        syncProfileAuthToCodexAuthFile: (profileId, authData) =>
          this.syncProfileAuthToCodexAuthFile(profileId, authData),
      },
      active,
    )
  }

  createWatchers(
    onChanged: () => void,
    authPath?: string,
  ): vscode.Disposable[] {
    return this.profileAuthSyncService.createWatchers(onChanged, authPath)
  }
}
