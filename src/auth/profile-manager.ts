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
import type { ProfileAuthReplacementOutcome } from './profile-storage-service'

/**
 * Result of an attempt to preserve the current live authentication from the
 * Codex auth.json file to the currently-active profile.
 */
interface LiveAuthPreservationResult {
  /** Status of the preservation attempt: whether no live auth existed, auth was saved, or auth was not saved. */
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

/**
 * Result of preparing for a new login in Codex chat.
 */
interface PrepareForNewLoginChatResult {
  /** Whether the active auth file was removed during preparation. */
  removedAuthFile: boolean
}

/**
 * Manages the lifecycle and operations of user profiles, including creation,
 * deletion, switching, and synchronization with the Codex authentication system.
 * Acts as a facade over the underlying profile storage and auth sync services.
 */
export class ProfileManager {
  /**
   * Creates a new ProfileManager instance.
   * @param codexHomeManager - Manager for Codex home directory configuration and switching.
   * @param deps - Dependencies including file system, state storage, and messaging interfaces.
   */
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

  /**
   * Gets the file path to the active Codex authentication file.
   * @returns The full path to the currently active auth.json file.
   */
  getActiveCodexAuthPath(): string {
    return this.runtime.getActiveCodexAuthPath()
  }

  /**
   * Gets the currently active Codex home configuration.
   * @returns Summary information about the active Codex home.
   */
  getActiveCodexHomeSummary() {
    return this.runtime.getActiveCodexHomeSummary()
  }

  /**
   * Lists all stored profiles in order.
   * @returns A promise that resolves to an array of profile summaries.
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    return this.profileStorageService.listProfiles()
  }

  /**
   * Retrieves a specific profile by ID.
   * @param profileId - The ID of the profile to retrieve.
   * @returns A promise that resolves to the profile summary, or undefined if not found.
   */
  async getProfile(profileId: string): Promise<ProfileSummary | undefined> {
    return this.profileStorageService.getProfile(profileId)
  }

  /**
   * Exports all profiles for transfer to another machine or VS Code instance.
   * @returns A promise that resolves to an object containing the export data and count of skipped profiles.
   */
  async exportProfilesForTransfer(): Promise<{
    data: ExportedSettingsV1
    skipped: number
  }> {
    return this.profileTransferService.exportProfilesForTransfer()
  }

  /**
   * Imports profiles from a previous export.
   * @param value - The export data to import (typically from exportProfilesForTransfer).
   * @returns A promise that resolves to the import result with created/updated profile counts.
   */
  async importProfilesFromTransfer(
    value: unknown,
  ): Promise<ImportProfilesResult> {
    return this.profileTransferService.importProfilesFromTransfer(value)
  }

  /**
   * Finds an existing profile that matches the given authentication data.
   * @param authData - The authentication data to search for.
   * @returns A promise that resolves to a matching profile summary, or undefined if not found.
   */
  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    return this.profileStorageService.findDuplicateProfile(authData)
  }

  /**
   * Replaces the authentication data for a profile with new credentials.
   * @param profileId - The ID of the profile to update.
   * @param authData - The new authentication data.
   * @returns A promise that resolves to true if the replacement succeeded, false otherwise.
   */
  async replaceProfileAuth(
    profileId: string,
    authData: AuthData,
  ): Promise<boolean> {
    return this.profileStorageService.replaceProfileAuth(profileId, authData)
  }

  /**
   * Conditionally replaces profile auth if the new auth is fresher than the stored auth.
   * @param profileId - The ID of the profile to update.
   * @param refreshedAuth - The refreshed authentication data from Codex.
   * @param baselineAuth - The baseline auth used to detect concurrent modifications.
   * @returns A promise that resolves to an outcome indicating whether auth was updated, unchanged, conflicted, etc.
   */
  async replaceProfileAuthIfFresher(
    profileId: string,
    refreshedAuth: AuthData,
    baselineAuth: AuthData,
  ): Promise<ProfileAuthReplacementOutcome> {
    return this.profileStorageService.replaceProfileAuthIfFresher(
      profileId,
      refreshedAuth,
      baselineAuth,
    )
  }

  /**
   * Creates a new profile with the given name and authentication data.
   * @param name - The display name for the profile.
   * @param authData - The authentication data for the profile.
   * @returns A promise that resolves to the created profile summary.
   */
  async createProfile(
    name: string,
    authData: AuthData,
  ): Promise<ProfileSummary> {
    return this.profileStorageService.createProfile(name, authData)
  }

  /**
   * Renames an existing profile.
   * @param profileId - The ID of the profile to rename.
   * @param newName - The new display name for the profile.
   * @returns A promise that resolves to true if the rename succeeded, false otherwise.
   */
  async renameProfile(profileId: string, newName: string): Promise<boolean> {
    return this.profileStorageService.renameProfile(profileId, newName)
  }

  /**
   * Deletes a profile and its associated authentication data.
   * @param profileId - The ID of the profile to delete.
   * @returns A promise that resolves to true if the deletion succeeded, false otherwise.
   */
  async deleteProfile(profileId: string): Promise<boolean> {
    return this.profileStorageService.deleteProfile(profileId)
  }

  /**
   * Loads the full authentication data for a profile.
   * @param profileId - The ID of the profile.
   * @returns A promise that resolves to the auth data, or null if not found or inaccessible.
   */
  async loadAuthData(profileId: string): Promise<AuthData | null> {
    return this.profileStorageService.loadAuthData(profileId)
  }

  /**
   * Gets the ID of the currently active profile.
   * @returns A promise that resolves to the active profile ID, or undefined if none is active.
   */
  async getActiveProfileId(): Promise<string | undefined> {
    return this.profileStateService.getActiveProfileId()
  }

  /**
   * Prepares the state for a new login in Codex chat, clearing the current active profile.
   * @returns A promise that resolves to the preparation result.
   */
  async prepareForNewLoginChat(): Promise<PrepareForNewLoginChatResult> {
    return this.profileStateService.prepareForNewLoginChat()
  }

  /**
   * Sets the currently active profile by ID.
   * @param profileId - The ID of the profile to activate, or undefined to deactivate all profiles.
   * @returns A promise that resolves to true if the change succeeded, false otherwise.
   */
  async setActiveProfileId(profileId: string | undefined): Promise<boolean> {
    return this.profileStateService.setActiveProfileId(profileId)
  }

  /**
   * Synchronizes the active profile from the default home's shared state (remote mode only).
   * @returns A promise that resolves to the synced profile ID, or undefined if not found.
   */
  async syncActiveProfileFromDefaultHome(): Promise<string | undefined> {
    return this.profileStateService.syncActiveProfileFromDefaultHome()
  }

  /**
   * Gets the ID of the last active profile before the current one.
   * @returns A promise that resolves to the last profile ID, or undefined if no previous profile exists.
   */
  async getLastProfileId(): Promise<string | undefined> {
    return this.profileStateService.getLastProfileId()
  }

  /**
   * Sets the ID of the last active profile.
   * @param profileId - The profile ID to store, or undefined to clear the last profile.
   * @returns A promise that resolves when the operation completes.
   */
  async setLastProfileId(profileId: string | undefined): Promise<void> {
    return this.profileStateService.setLastProfileId(profileId)
  }

  /**
   * Toggles between the current and previous active profiles.
   * @returns A promise that resolves to the newly activated profile ID, or undefined if toggle failed.
   */
  async toggleLastProfileId(): Promise<string | undefined> {
    return this.profileStateService.toggleLastProfileId()
  }

  /**
   * Reconciles the active profile's state with the current Codex auth.json file.
   * Handles cases where the auth file has been modified externally or by Codex.
   * @returns A promise that resolves when reconciliation completes.
   */
  async reconcileActiveProfileWithCodexAuthFile(): Promise<void> {
    await this.profileAuthSyncService.reconcileActiveProfileWithCodexAuthFile()
  }

  /**
   * Attempts to preserve the current live authentication from the Codex auth.json
   * file to the active profile if a matching profile exists.
   * @returns A promise that resolves to the preservation result.
   */
  async preserveLiveAuthForMatchingProfile(): Promise<LiveAuthPreservationResult> {
    return this.profileAuthRecoveryService.preserveLiveAuthForMatchingProfile()
  }

  /**
   * Synchronizes the active profile's authentication to the Codex auth.json file.
   * @returns A promise that resolves when synchronization completes.
   */
  async syncActiveProfileToCodexAuthFile(): Promise<void> {
    const active = await this.getActiveProfileId()
    if (!active) {
      return
    }
    await this.profileAuthFileService.syncActiveProfileToCodexAuthFile(active)
  }

  /**
   * Creates file system watchers to monitor changes to the Codex auth file.
   * @param onChanged - Callback function invoked when the auth file changes.
   * @param authPath - Optional path to the auth file to watch; defaults to the active path.
   * @returns An array of disposables for the created watchers.
   */
  createWatchers(
    onChanged: () => void,
    authPath?: string,
  ): vscode.Disposable[] {
    return this.profileAuthSyncService.createWatchers(onChanged, authPath)
  }
}
