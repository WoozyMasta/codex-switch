import type * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { AuthData, ProfileSummary, StorageMode } from '../types'
import {
  extractAuthDataFromAuthJson,
  loadAuthDataFromFile,
} from './auth-manager'
import { buildCodexAuthJson, syncCodexAuthFile } from './codex-auth-sync'
import {
  SharedActiveProfile,
  deleteFileIfExists,
  ensureSharedStoreDirs,
  getSharedActiveProfilePath,
  getSharedActiveProfilePathForHome,
  getSharedProfileSecretsPath,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
} from './shared-profile-store'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from '../utils/auth-identity'
import { parseProfilesFile } from '../utils/profiles-file'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import { resolveStorageMode } from '../utils/storage-mode'
import { resolveSharedActiveProfile } from '../utils/shared-active-profile'
import { resolveProfilesPath } from '../utils/profile-storage-paths'
import { withProfilesFileLock } from '../utils/profiles-file-lock'
import {
  readProfilesFile,
  requireWritableProfilesFile,
  writeProfilesFile,
} from '../utils/profile-files-storage'
import type { ProfilesFileV1 } from '../utils/profiles-file'
import {
  deleteStoredProfileTokens,
  readStoredProfileTokens,
  writeStoredProfileTokens,
} from '../utils/profile-token-storage'
import {
  captureLiveAuthForMatchingProfile,
  maybeSyncProfileAuthToCodexAuthFile,
} from '../utils/profile-live-auth-sync'
import { findMatchingProfileIdForAuth } from '../utils/profile-auth-match'
import { buildProfileAuthData } from '../utils/profile-auth-data'
import { buildProfileSecretKeys } from '../utils/profile-secret-keys'
import { sortLegacyProfileMigrationCandidates } from '../utils/legacy-profile-migration'
import { sha256Text } from '../utils/text-hash'
import {
  buildProfileSummaryFromAuth,
  buildProfileTokensFromAuth,
  type ProfileTokens,
} from '../utils/profile-records'
import {
  ProfileTransferService,
  type ExportedSettingsV1,
  type ImportProfilesResult,
} from './profile-transfer-service'
import { ProfileAuthSyncService } from './profile-auth-sync-service'
import { ProfileAuthRecoveryService } from './profile-auth-recovery-service'
import { ProfileStateService } from './profile-state-service'

const PROFILES_FILENAME = 'profiles.json'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

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
    this.showWarningMessage = deps.showWarningMessage
    this.translate = deps.translate
    this.createDisposable = deps.createDisposable
    this.uriFile = deps.uriFile
    this.relativePattern = deps.relativePattern
    this.profileTransferService = new ProfileTransferService({
      listProfiles: () => this.listProfiles(),
      getActiveProfileId: () => this.getActiveProfileId(),
      getLastProfileId: () => this.getLastProfileId(),
      readStoredTokens: (profileId) => this.readStoredTokens(profileId),
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
      listProfiles: () => this.listProfiles(),
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
      listProfiles: () => this.listProfiles(),
      loadAuthData: (profileId) => this.loadAuthData(profileId),
      loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
      getActiveCodexAuthPath: () => this.getActiveCodexAuthPath(),
      replaceProfileAuth: (profileId, authData) =>
        this.replaceProfileAuth(profileId, authData),
      deleteProfile: (profileId) => this.deleteProfile(profileId),
      readRemoteProfileTokens: (profileId) =>
        this.readRemoteProfileTokens(profileId),
      writeStoredTokens: (profileId, tokens) =>
        this.writeStoredTokens(profileId, tokens),
      isRemoteFilesMode: () => this.isRemoteFilesMode(),
      showWarningMessage: this.showWarningMessage,
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
        this.inferActiveProfileIdFromAuthFile(),
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
      readSharedActiveProfile: () => this.readSharedActiveProfile()?.profileId,
      readDefaultHomeSharedActiveProfileId: () =>
        readJsonFile<SharedActiveProfile>(
          getSharedActiveProfilePathForHome('default'),
        )?.profileId,
      readDefaultHomeSharedLegacyActiveProfileId: () =>
        readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
          ?.profileId,
      writeSharedActiveProfile: (profileId) =>
        this.writeSharedActiveProfile(profileId),
      deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
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
  private readonly showWarningMessage: typeof vscode.window.showWarningMessage
  private readonly translate: typeof vscode.l10n.t
  private readonly createDisposable: (dispose: () => void) => vscode.Disposable
  private readonly uriFile: (path: string) => vscode.Uri
  private readonly relativePattern: (
    base: vscode.Uri,
    pattern: string,
  ) => vscode.RelativePattern
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

  private getStorageDir(): string {
    if (this.isRemoteFilesMode()) {
      return getSharedStoreRoot()
    }
    return this.globalStorageUri.fsPath
  }

  private getProfilesPath(): string {
    return resolveProfilesPath(this.isRemoteFilesMode(), this.getStorageDir())
  }

  private profilesFileStorageDeps(): {
    ensureStorageDir: () => void
    getProfilesPath: () => string
    writeJsonFile: (path: string, data: ProfilesFileV1) => void
    showReadErrorMessage: (path: string) => void
    showWriteErrorMessage: (path: string) => void
  } {
    return {
      ensureStorageDir: () => this.ensureStorageDir(),
      getProfilesPath: () => this.getProfilesPath(),
      writeJsonFile: (path: string, data: ProfilesFileV1) =>
        writeJsonFile(path, data),
      showReadErrorMessage: (path: string) =>
        void this.showErrorMessage(
          this.translate(
            'Profile storage at {0} is corrupted and was not loaded.',
            path,
          ),
        ),
      showWriteErrorMessage: (path: string) =>
        void this.showErrorMessage(
          this.translate(
            'Profile storage at {0} is corrupted and cannot be modified.',
            path,
          ),
        ),
    }
  }

  private ensureStorageDir() {
    if (this.isRemoteFilesMode()) {
      ensureSharedStoreDirs()
      return
    }

    const dir = this.getStorageDir()
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true })
    }
  }

  private readSharedActiveProfile(): SharedActiveProfile | null {
    if (!this.isRemoteFilesMode()) {
      return null
    }
    const home = this.getActiveCodexHome()
    return resolveSharedActiveProfile(
      readJsonFile<SharedActiveProfile>(
        getSharedActiveProfilePathForHome(home.id),
      ),
      readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath()),
      home.isDefault,
    )
  }

  private writeSharedActiveProfile(profileId: string): void {
    if (!this.isRemoteFilesMode()) {
      return
    }
    writeJsonFile(
      getSharedActiveProfilePathForHome(this.getActiveCodexHome().id),
      {
        profileId,
        updatedAt: new Date().toISOString(),
      } satisfies SharedActiveProfile,
    )
  }

  private deleteSharedActiveProfile(): void {
    if (!this.isRemoteFilesMode()) {
      return
    }
    deleteFileIfExists(
      getSharedActiveProfilePathForHome(this.getActiveCodexHome().id),
    )
  }

  private readRemoteProfileTokens(profileId: string): ProfileTokens | null {
    return readJsonFile<ProfileTokens>(getSharedProfileSecretsPath(profileId))
  }

  private async readStoredTokens(
    profileId: string,
  ): Promise<ProfileTokens | null> {
    return readStoredProfileTokens(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        readRemoteProfileTokens: (value) => this.readRemoteProfileTokens(value),
        writeRemoteProfileTokens: (value, tokens) =>
          this.writeRemoteProfileTokens(value, tokens),
        deleteRemoteProfileTokens: (value) =>
          this.deleteRemoteProfileTokens(value),
        readLocalStoredTokens: (value) => this.readLocalStoredTokens(value),
        writeLocalStoredTokens: (value, tokens) =>
          this.writeLocalStoredTokens(value, tokens),
        deleteLocalStoredTokens: (value) => this.deleteLocalStoredTokens(value),
      },
      profileId,
    )
  }

  private async writeStoredTokens(
    profileId: string,
    tokens: ProfileTokens,
  ): Promise<void> {
    await writeStoredProfileTokens(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        readRemoteProfileTokens: (value) => this.readRemoteProfileTokens(value),
        writeRemoteProfileTokens: (value, storedTokens) =>
          this.writeRemoteProfileTokens(value, storedTokens),
        deleteRemoteProfileTokens: (value) =>
          this.deleteRemoteProfileTokens(value),
        readLocalStoredTokens: (value) => this.readLocalStoredTokens(value),
        writeLocalStoredTokens: (value, storedTokens) =>
          this.writeLocalStoredTokens(value, storedTokens),
        deleteLocalStoredTokens: (value) => this.deleteLocalStoredTokens(value),
      },
      profileId,
      tokens,
    )
  }

  private async deleteStoredTokens(profileId: string): Promise<void> {
    await deleteStoredProfileTokens(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        readRemoteProfileTokens: (value) => this.readRemoteProfileTokens(value),
        writeRemoteProfileTokens: (value, storedTokens) =>
          this.writeRemoteProfileTokens(value, storedTokens),
        deleteRemoteProfileTokens: (value) =>
          this.deleteRemoteProfileTokens(value),
        readLocalStoredTokens: (value) => this.readLocalStoredTokens(value),
        writeLocalStoredTokens: (value, storedTokens) =>
          this.writeLocalStoredTokens(value, storedTokens),
        deleteLocalStoredTokens: (value) => this.deleteLocalStoredTokens(value),
      },
      profileId,
    )
  }

  private writeRemoteProfileTokens(
    profileId: string,
    tokens: ProfileTokens,
  ): void {
    ensureSharedStoreDirs()
    writeJsonFile(getSharedProfileSecretsPath(profileId), tokens)
  }

  private deleteRemoteProfileTokens(profileId: string): void {
    deleteFileIfExists(getSharedProfileSecretsPath(profileId))
  }

  private async readLocalStoredTokens(
    profileId: string,
  ): Promise<ProfileTokens | null> {
    const keys = buildProfileSecretKeys(profileId)
    const raw =
      (await this.secrets.get(keys.current)) ||
      (await this.secrets.get(keys.legacy))
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as ProfileTokens
    } catch {
      return null
    }
  }

  private async writeLocalStoredTokens(
    profileId: string,
    tokens: ProfileTokens,
  ): Promise<void> {
    const keys = buildProfileSecretKeys(profileId)
    await this.secrets.store(keys.current, JSON.stringify(tokens))
  }

  private async deleteLocalStoredTokens(profileId: string): Promise<void> {
    const keys = buildProfileSecretKeys(profileId)
    await this.secrets.delete(keys.current)
    await this.secrets.delete(keys.legacy)
  }

  private getGlobalStorageRoot(): string {
    // .../User/globalStorage/<publisher.name> -> .../User/globalStorage
    return path.dirname(this.globalStorageUri.fsPath)
  }

  private async tryMigrateLegacyProfilesOnce(): Promise<void> {
    if (this.globalState.get<boolean>(MIGRATED_LEGACY_KEY)) {
      return
    }

    const current = await readProfilesFile(this.profilesFileStorageDeps())
    if (current.profiles.length > 0) {
      await this.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const root = this.getGlobalStorageRoot()
    if (!this.fs.existsSync(root)) {
      await this.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const currentDirName = path.basename(this.getStorageDir())
    const candidates: string[] = []

    try {
      const entries = this.fs.readdirSync(root, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) {
          continue
        }
        const name = e.name
        if (name === currentDirName) {
          continue
        }
        if (!name.endsWith('.codex-switch') && !name.endsWith('.codex-stats')) {
          continue
        }
        candidates.push(name)
      }
    } catch {
      await this.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    // Prefer older ids we used during development.
    candidates.splice(
      0,
      candidates.length,
      ...sortLegacyProfileMigrationCandidates(candidates),
    )

    for (const dirName of candidates) {
      const legacyProfilesPath = path.join(root, dirName, PROFILES_FILENAME)
      if (!this.fs.existsSync(legacyProfilesPath)) {
        continue
      }

      try {
        const raw = this.fs.readFileSync(legacyProfilesPath, 'utf8')
        const legacy = parseProfilesFile(raw)
        if (!legacy || legacy.profiles.length === 0) {
          continue
        }

        // Only migrate the profile list. Tokens are stored in SecretStorage and cannot be
        // read across extension ids.
        writeProfilesFile(this.profilesFileStorageDeps(), {
          version: 1,
          profiles: legacy.profiles,
        })

        void this.showInformationMessage(
          this.translate(
            'Found profiles from a previous install. Please re-import auth.json for each profile to restore tokens.',
          ),
        )
        break
      } catch {
        // keep trying other candidates
      }
    }

    await this.globalState.update(MIGRATED_LEGACY_KEY, true)
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    await this.tryMigrateLegacyProfilesOnce()
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return [...file.profiles].sort((a, b) => a.name.localeCompare(b.name))
  }

  async getProfile(profileId: string): Promise<ProfileSummary | undefined> {
    const profiles = await this.listProfiles()
    return profiles.find((p) => p.id === profileId)
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

  private async inferActiveProfileIdFromAuthFile(): Promise<
    string | undefined
  > {
    const authData = await loadAuthDataFromFile(this.getActiveCodexAuthPath())
    if (!authData) {
      return undefined
    }

    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return findMatchingProfileIdForAuth(file.profiles, authData)
  }

  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return file.profiles.find((p) => this.matchesAuth(p, authData))
  }

  private async recoverMissingTokens(
    profileId: string,
  ): Promise<AuthData | null> {
    const profile = await this.getProfile(profileId)
    const recoverLabel = this.translate('Recover from remote store')
    const importLabel = this.translate('Import current ~/.codex/auth.json')
    const deleteLabel = this.translate('Delete broken profile')

    const canRecoverFromRemote =
      !this.isRemoteFilesMode() &&
      this.readRemoteProfileTokens(profileId) != null

    const pick = await this.showWarningMessage(
      this.translate(
        'Profile "{0}" is missing tokens. Restore it before switching.',
        profile?.name || profileId,
      ),
      { modal: true },
      ...(canRecoverFromRemote ? [recoverLabel] : []),
      importLabel,
      deleteLabel,
    )

    if (pick === recoverLabel) {
      const tokens = this.readRemoteProfileTokens(profileId)
      if (tokens) {
        await this.writeStoredTokens(profileId, tokens)
        return this.loadAuthData(profileId)
      }
    }

    if (pick === importLabel) {
      const authData = await loadAuthDataFromFile(this.getActiveCodexAuthPath())
      if (!authData) {
        void this.showErrorMessage(
          this.translate(
            'Could not read auth from {0}. Run "codex login" first.',
            this.getActiveCodexAuthPath(),
          ),
        )
        return null
      }
      await this.replaceProfileAuth(profileId, authData)
      return authData
    }

    if (pick === deleteLabel) {
      await this.deleteProfile(profileId)
    }

    return null
  }

  async replaceProfileAuth(
    profileId: string,
    authData: AuthData,
  ): Promise<boolean> {
    const previousTokens = await this.readStoredTokens(profileId)
    const tokens = buildProfileTokensFromAuth(authData)

    return withProfilesFileLock(this.getProfilesPath(), async () => {
      const file = await requireWritableProfilesFile(
        this.profilesFileStorageDeps(),
      )
      if (!file) {
        return false
      }
      const idx = file.profiles.findIndex((p) => p.id === profileId)
      if (idx === -1) {
        return false
      }

      await this.writeStoredTokens(profileId, tokens)

      file.profiles[idx] = {
        ...file.profiles[idx],
        email: authData.email,
        planType: authData.planType,
        accountId: authData.accountId,
        defaultOrganizationId: authData.defaultOrganizationId,
        defaultOrganizationTitle: authData.defaultOrganizationTitle,
        chatgptUserId: authData.chatgptUserId,
        userId: authData.userId,
        subject: authData.subject,
        updatedAt: new Date().toISOString(),
      }

      try {
        writeProfilesFile(this.profilesFileStorageDeps(), file)
        return true
      } catch (error) {
        try {
          if (previousTokens) {
            await this.writeStoredTokens(profileId, previousTokens)
          } else {
            await this.deleteStoredTokens(profileId)
          }
        } catch {
          // Best-effort rollback.
        }
        throw error
      }
    })
  }

  async createProfile(
    name: string,
    authData: AuthData,
  ): Promise<ProfileSummary> {
    const now = new Date().toISOString()
    const id = randomUUID()

    const profile = buildProfileSummaryFromAuth(id, name, authData, now)
    const tokens = buildProfileTokensFromAuth(authData)

    await withProfilesFileLock(this.getProfilesPath(), async () => {
      const file = await requireWritableProfilesFile(
        this.profilesFileStorageDeps(),
      )
      if (!file) {
        throw new Error('Profile storage is corrupted and cannot be modified.')
      }

      await this.writeStoredTokens(id, tokens)

      file.profiles.push(profile)
      try {
        writeProfilesFile(this.profilesFileStorageDeps(), file)
      } catch (error) {
        try {
          await this.deleteStoredTokens(id)
        } catch {
          // Best-effort rollback.
        }
        throw error
      }
    })

    return profile
  }

  async renameProfile(profileId: string, newName: string): Promise<boolean> {
    return withProfilesFileLock(this.getProfilesPath(), async () => {
      const file = await requireWritableProfilesFile(
        this.profilesFileStorageDeps(),
      )
      if (!file) {
        return false
      }
      const idx = file.profiles.findIndex((p) => p.id === profileId)
      if (idx === -1) {
        return false
      }
      file.profiles[idx] = {
        ...file.profiles[idx],
        name: newName,
        updatedAt: new Date().toISOString(),
      }
      writeProfilesFile(this.profilesFileStorageDeps(), file)
      return true
    })
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    return withProfilesFileLock(this.getProfilesPath(), async () => {
      const file = await requireWritableProfilesFile(
        this.profilesFileStorageDeps(),
      )
      if (!file) {
        return false
      }
      const before = file.profiles.length
      file.profiles = file.profiles.filter((p) => p.id !== profileId)
      if (file.profiles.length === before) {
        return false
      }
      writeProfilesFile(this.profilesFileStorageDeps(), file)

      await this.deleteStoredTokens(profileId)

      // Clean up active/last if they point to deleted profile.
      const active = await this.getActiveProfileId()
      const last = await this.getLastProfileId()
      if (active === profileId) {
        await this.setActiveProfileId(undefined)
      }
      if (last === profileId) {
        await this.setLastProfileId(undefined)
      }
      return true
    })
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
    const profile = await this.getProfile(profileId)
    if (!profile) {
      return null
    }

    const tokens = await this.readStoredTokens(profileId)
    if (!tokens) {
      return null
    }

    const extracted = extractAuthDataFromAuthJson(tokens.authJson)
    return buildProfileAuthData(profile, tokens, extracted)
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
