import type * as vscode from 'vscode'
import { AuthData, ProfileSummary, StorageMode } from '../types'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import { resolveStorageMode } from '../utils/storage-mode'
import {
  type ExportedSettingsV1,
  type ImportProfilesResult,
} from './profile-transfer-service'
import {
  ProfileManagerRuntime,
  type ProfileManagerDeps,
} from './profile-manager-runtime'

// Backward compatibility keys (pre-rename).
interface LiveAuthPreservationResult {
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

interface PrepareForNewLoginChatResult {
  removedAuthFile: boolean
}

export class ProfileManager {
  constructor(codexHomeManager: CodexHomeManager, deps: ProfileManagerDeps) {
    this.runtime = new ProfileManagerRuntime(codexHomeManager, deps)
  }

  private readonly runtime: ProfileManagerRuntime

  private get fs() {
    return this.runtime.fs
  }

  private get getConfiguration() {
    return this.runtime.getConfiguration
  }

  private get remoteName() {
    return this.runtime.remoteName
  }

  private get globalState() {
    return this.runtime.globalState
  }

  private get workspaceState() {
    return this.runtime.workspaceState
  }

  private get secrets() {
    return this.runtime.secrets
  }

  private get globalStorageUri() {
    return this.runtime.globalStorageUri
  }

  private get createFileSystemWatcher() {
    return this.runtime.createFileSystemWatcher
  }

  private get showErrorMessage() {
    return this.runtime.showErrorMessage
  }

  private get showInformationMessage() {
    return this.runtime.showInformationMessage
  }

  private get translate() {
    return this.runtime.translate
  }

  private get createDisposable() {
    return this.runtime.createDisposable
  }

  private get uriFile() {
    return this.runtime.uriFile
  }

  private get relativePattern() {
    return this.runtime.relativePattern
  }

  private get profileStorageService() {
    return this.runtime.profileStorageService
  }

  private get profileAuthFileService() {
    return this.runtime.profileAuthFileService
  }

  private get profileTransferService() {
    return this.runtime.profileTransferService
  }

  private get profileAuthSyncService() {
    return this.runtime.profileAuthSyncService
  }

  private get profileAuthRecoveryService() {
    return this.runtime.profileAuthRecoveryService
  }

  private get profileStateService() {
    return this.runtime.profileStateService
  }

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
    return this.runtime.getActiveCodexHomeSummary()
  }

  getActiveCodexAuthPath(): string {
    return this.runtime.getActiveCodexAuthPath()
  }

  getActiveCodexHomeSummary() {
    return this.runtime.getActiveCodexHomeSummary()
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
    await this.profileAuthFileService.syncActiveProfileToCodexAuthFile(active)
  }

  createWatchers(
    onChanged: () => void,
    authPath?: string,
  ): vscode.Disposable[] {
    return this.profileAuthSyncService.createWatchers(onChanged, authPath)
  }
}
