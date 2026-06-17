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
  getSharedActiveProfilesDir,
  SHARED_ACTIVE_PROFILE_FILENAME,
  deleteFileIfExists,
  ensureSharedStoreDirs,
  getSharedActiveProfilePath,
  getSharedActiveProfilePathForHome,
  getSharedProfileSecretsPath,
  getSharedProfilesDir,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
} from './shared-profile-store'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from '../utils/auth-identity'
import { shouldReplaceStoredProfileAuthWithLive } from '../utils/auth-refresh-policy'
import { parseProfilesFile } from '../utils/profiles-file'
import { matchesPreservationIdentityForProfile } from '../utils/preservation-identity'
import { resolveStorageMode } from '../utils/storage-mode'
import {
  resolveDefaultHomeActiveProfileId,
  resolveSharedActiveProfile,
} from '../utils/shared-active-profile'
import { buildProfileStateKeys } from '../utils/profile-state-keys'
import {
  isNonDefaultPerHomeState,
  shouldMigrateLegacyProfileState,
} from '../utils/profile-state-policy'
import { resolveProfilesPath } from '../utils/profile-storage-paths'
import { resolveProfileStateBucket } from '../utils/profile-state-buckets'
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
  resolveActiveProfileId,
  setActiveProfileIdInState,
} from '../utils/profile-active-state'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import {
  captureLiveAuthForMatchingProfile,
  maybeSyncProfileAuthToCodexAuthFile,
} from '../utils/profile-live-auth-sync'
import {
  readLastProfileIdFromState,
  toggleLastProfileId,
  writeLastProfileIdToState,
} from '../utils/profile-last-state'
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

const PROFILES_FILENAME = 'profiles.json'
const ACTIVE_PROFILE_KEY = 'codexSwitch.activeProfileId'
const LAST_PROFILE_KEY = 'codexSwitch.lastProfileId'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

// Backward compatibility keys (pre-rename).
const OLD_ACTIVE_PROFILE_KEY = 'codexUsage.activeProfileId'
const OLD_LAST_PROFILE_KEY = 'codexUsage.lastProfileId'
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

  private async preserveStoredProfileAuthFromLive(
    profileId: string,
  ): Promise<void> {
    try {
      const profile = await this.getProfile(profileId)
      if (!profile) {
        return
      }

      const liveAuth = await this.loadLiveCodexAuthData()
      if (!liveAuth) {
        return
      }

      await maybeReplaceProfileAuthWithLive(
        {
          loadAuthData: (profileId) => this.loadAuthData(profileId),
          replaceProfileAuth: (profileId, authData) =>
            this.replaceProfileAuth(profileId, authData),
        },
        profile,
        liveAuth,
      )
    } catch {
      // Best-effort preservation; switching should continue.
    }
  }

  async preserveLiveAuthForMatchingProfile(): Promise<LiveAuthPreservationResult> {
    const liveAuth = await this.loadLiveCodexAuthData()
    if (!liveAuth) {
      return { status: 'noLiveAuth' }
    }

    const activeId = await this.getActiveProfileId()
    const matchingProfile = await findProfileByPreservationIdentity(
      {
        listProfiles: () => this.listProfiles(),
        loadAuthData: (profileId) => this.loadAuthData(profileId),
      },
      liveAuth,
      activeId,
    )

    if (!matchingProfile) {
      return { status: 'unsaved' }
    }

    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: (profileId) => this.loadAuthData(profileId),
        replaceProfileAuth: (profileId, authData) =>
          this.replaceProfileAuth(profileId, authData),
      },
      matchingProfile,
      liveAuth,
    )

    return { status: 'saved' }
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

  private getStateBucket(): vscode.Memento {
    const newCfg = this.getConfiguration('codexSwitch')
    const scopeFromNew = newCfg.get<'global' | 'workspace'>(
      'activeProfileScope',
    )
    const scope =
      scopeFromNew ||
      this.getConfiguration('codexUsage').get<'global' | 'workspace'>(
        'activeProfileScope',
        'global',
      )
    return resolveProfileStateBucket(
      scope,
      this.globalState,
      this.workspaceState,
    )
  }

  private getLegacyStateBucket(): vscode.Memento {
    const scope = this.getConfiguration('codexUsage').get<
      'global' | 'workspace'
    >('activeProfileScope', 'global')
    return resolveProfileStateBucket(
      scope,
      this.globalState,
      this.workspaceState,
    )
  }

  private activeProfileKey(): string {
    return buildProfileStateKeys(this.getActiveCodexHome().id).active
  }

  private lastProfileKey(): string {
    return buildProfileStateKeys(this.getActiveCodexHome().id).last
  }

  private shouldMigrateLegacyProfileState(): boolean {
    return shouldMigrateLegacyProfileState(this.getActiveCodexHome())
  }

  private shouldInheritDefaultProfileWhenEmpty(): boolean {
    const cfg = this.getConfiguration('codexSwitch')
    return cfg.get<boolean>('codexHome.inheritDefaultProfileWhenEmpty', true)
  }

  private isNonDefaultPerHomeState(): boolean {
    return isNonDefaultPerHomeState(this.getActiveCodexHome())
  }

  private isActiveCodexAuthFileMissing(): boolean {
    return !this.fs.existsSync(this.getActiveCodexAuthPath())
  }

  private async getDefaultHomeActiveProfileId(): Promise<string | undefined> {
    return resolveDefaultHomeActiveProfileId(
      readJsonFile<SharedActiveProfile>(
        getSharedActiveProfilePathForHome('default'),
      )?.profileId,
      readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
        ?.profileId,
      this.getStateBucket().get<string>(`${ACTIVE_PROFILE_KEY}.default`),
      this.getStateBucket().get<string>(ACTIVE_PROFILE_KEY),
      this.getStateBucket().get<string>(OLD_ACTIVE_PROFILE_KEY),
      this.getLegacyStateBucket().get<string>(OLD_ACTIVE_PROFILE_KEY),
      this.isRemoteFilesMode(),
    )
  }

  private async inheritDefaultProfileIfCurrentHomeIsEmpty(): Promise<
    string | undefined
  > {
    if (!this.isNonDefaultPerHomeState()) {
      return undefined
    }
    if (!this.shouldInheritDefaultProfileWhenEmpty()) {
      return undefined
    }
    if (!this.isActiveCodexAuthFileMissing()) {
      return undefined
    }

    const defaultProfileId = await this.getDefaultHomeActiveProfileId()
    if (!defaultProfileId) {
      return undefined
    }
    const existing = await this.getProfile(defaultProfileId)
    if (!existing) {
      return undefined
    }

    await setActiveProfileIdInState(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        currentBucket: this.getStateBucket(),
        keys: {
          current: this.activeProfileKey(),
          legacy: OLD_ACTIVE_PROFILE_KEY,
        },
        writeSharedActiveProfile: (profileId) =>
          this.writeSharedActiveProfile(profileId),
        deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
      },
      defaultProfileId,
    )
    return defaultProfileId
  }

  async getActiveProfileId(): Promise<string | undefined> {
    return resolveActiveProfileId({
      isRemoteFilesMode: this.isRemoteFilesMode(),
      currentBucket: this.getStateBucket(),
      legacyBucket: this.getLegacyStateBucket(),
      keys: {
        current: this.activeProfileKey(),
        currentBase: ACTIVE_PROFILE_KEY,
        legacy: OLD_ACTIVE_PROFILE_KEY,
      },
      shouldMigrateLegacyProfileState: this.shouldMigrateLegacyProfileState(),
      readSharedActiveProfile: () => this.readSharedActiveProfile()?.profileId,
      writeSharedActiveProfile: (profileId) =>
        this.writeSharedActiveProfile(profileId),
      getProfile: (profileId) => this.getProfile(profileId),
      inferActiveProfileIdFromAuthFile: () =>
        this.inferActiveProfileIdFromAuthFile(),
      inheritDefaultProfileIfCurrentHomeIsEmpty: () =>
        this.inheritDefaultProfileIfCurrentHomeIsEmpty(),
    })
  }

  async prepareForNewLoginChat(): Promise<PrepareForNewLoginChatResult> {
    const authPath = this.getActiveCodexAuthPath()

    await setActiveProfileIdInState(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        currentBucket: this.getStateBucket(),
        keys: {
          current: this.activeProfileKey(),
          legacy: OLD_ACTIVE_PROFILE_KEY,
        },
        writeSharedActiveProfile: (profileId) =>
          this.writeSharedActiveProfile(profileId),
        deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
      },
      undefined,
    )
    this.lastSyncedProfileId = undefined
    this.lastSyncedAuthHash = undefined

    if (!this.fs.existsSync(authPath)) {
      return {
        removedAuthFile: false,
      }
    }

    this.fs.unlinkSync(authPath)

    return {
      removedAuthFile: true,
    }
  }

  async setActiveProfileId(profileId: string | undefined): Promise<boolean> {
    const prev = await this.getActiveProfileId()

    let authData: AuthData | null = null
    if (profileId) {
      authData = await this.loadAuthData(profileId)
      if (!authData) {
        authData = await this.recoverMissingTokens(profileId)
        if (!authData) {
          return false
        }
      }
    }

    if (prev && profileId && prev === profileId) {
      if (!authData) {
        return false
      }
      const selectedProfile = await this.getProfile(profileId)
      const liveAuth = await this.loadLiveCodexAuthData()
      if (selectedProfile && liveAuth) {
        if (
          matchesPreservationIdentityForProfile(
            selectedProfile,
            liveAuth,
            authData,
          )
        ) {
          if (shouldReplaceStoredProfileAuthWithLive(authData, liveAuth)) {
            await this.replaceProfileAuth(selectedProfile.id, liveAuth)
          }
          return true
        }
      }
      this.syncProfileAuthToCodexAuthFile(profileId, authData)
      return true
    }

    if (prev && profileId && prev !== profileId) {
      await this.preserveStoredProfileAuthFromLive(prev)
      await this.setLastProfileId(prev)
    }

    await setActiveProfileIdInState(
      {
        isRemoteFilesMode: this.isRemoteFilesMode(),
        currentBucket: this.getStateBucket(),
        keys: {
          current: this.activeProfileKey(),
          legacy: OLD_ACTIVE_PROFILE_KEY,
        },
        writeSharedActiveProfile: (value) =>
          this.writeSharedActiveProfile(value),
        deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
      },
      profileId,
    )

    if (profileId && authData) {
      // We already validated tokens above; avoid a second secret read.
      this.syncProfileAuthToCodexAuthFile(profileId, authData)
    }
    return true
  }

  async syncActiveProfileFromDefaultHome(): Promise<string | undefined> {
    const defaultProfileId = await this.getDefaultHomeActiveProfileId()
    if (!defaultProfileId) {
      return undefined
    }
    const ok = await this.setActiveProfileId(defaultProfileId)
    return ok ? defaultProfileId : undefined
  }

  async getLastProfileId(): Promise<string | undefined> {
    return readLastProfileIdFromState(
      this.getStateBucket(),
      this.getLegacyStateBucket(),
      {
        current: this.lastProfileKey(),
        currentBase: LAST_PROFILE_KEY,
        legacy: OLD_LAST_PROFILE_KEY,
      },
      this.shouldMigrateLegacyProfileState(),
    )
  }

  private async setLastProfileId(profileId: string | undefined): Promise<void> {
    await writeLastProfileIdToState(
      this.getStateBucket(),
      {
        current: this.lastProfileKey(),
        currentBase: LAST_PROFILE_KEY,
        legacy: OLD_LAST_PROFILE_KEY,
      },
      profileId,
    )
  }

  async toggleLastProfileId(): Promise<string | undefined> {
    const active = await this.getActiveProfileId()
    const last = await this.getLastProfileId()
    return toggleLastProfileId(
      active,
      last,
      async (profileId) => this.setActiveProfileId(profileId),
      async (profileId) => this.setLastProfileId(profileId),
    )
  }

  async reconcileActiveProfileWithCodexAuthFile(): Promise<void> {
    const activeId = await this.getActiveProfileId()
    const activeProfile = activeId ? await this.getProfile(activeId) : undefined
    const liveAuth = await this.loadLiveCodexAuthData()

    if (liveAuth) {
      const activeStoredAuth = activeProfile
        ? await this.loadAuthData(activeProfile.id)
        : null
      if (
        activeProfile &&
        matchesPreservationIdentityForProfile(
          activeProfile,
          liveAuth,
          activeStoredAuth,
        )
      ) {
        await maybeReplaceProfileAuthWithLive(
          {
            loadAuthData: (profileId) => this.loadAuthData(profileId),
            replaceProfileAuth: (profileId, authData) =>
              this.replaceProfileAuth(profileId, authData),
          },
          activeProfile,
          liveAuth,
        )
        return
      }

      const matched = await findProfileByPreservationIdentity(
        {
          listProfiles: () => this.listProfiles(),
          loadAuthData: (profileId) => this.loadAuthData(profileId),
        },
        liveAuth,
        activeProfile ? activeProfile.id : undefined,
      )
      if (matched) {
        if (activeProfile && activeId && activeId !== matched.id) {
          await this.setLastProfileId(activeId)
        }
        await setActiveProfileIdInState(
          {
            isRemoteFilesMode: this.isRemoteFilesMode(),
            currentBucket: this.getStateBucket(),
            keys: {
              current: this.activeProfileKey(),
              legacy: OLD_ACTIVE_PROFILE_KEY,
            },
            writeSharedActiveProfile: (profileId) =>
              this.writeSharedActiveProfile(profileId),
            deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
          },
          matched.id,
        )
        await maybeReplaceProfileAuthWithLive(
          {
            loadAuthData: (profileId) => this.loadAuthData(profileId),
            replaceProfileAuth: (profileId, authData) =>
              this.replaceProfileAuth(profileId, authData),
          },
          matched,
          liveAuth,
        )
        return
      }

      if (activeId) {
        await this.setLastProfileId(activeId)
      }
      await setActiveProfileIdInState(
        {
          isRemoteFilesMode: this.isRemoteFilesMode(),
          currentBucket: this.getStateBucket(),
          keys: {
            current: this.activeProfileKey(),
            legacy: OLD_ACTIVE_PROFILE_KEY,
          },
          writeSharedActiveProfile: (profileId) =>
            this.writeSharedActiveProfile(profileId),
          deleteSharedActiveProfile: () => this.deleteSharedActiveProfile(),
        },
        undefined,
      )
      return
    }

    if (activeId) {
      await maybeSyncProfileAuthToCodexAuthFile(
        {
          lastSyncedProfileId: this.lastSyncedProfileId,
          loadAuthData: (profileId) => this.loadAuthData(profileId),
          syncProfileAuthToCodexAuthFile: (profileId, authData) =>
            this.syncProfileAuthToCodexAuthFile(profileId, authData),
        },
        activeId,
      )
    }
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
    const disposables: vscode.Disposable[] = []
    const fire = () => {
      try {
        onChanged()
      } catch {
        // ignore refresh errors from file watchers
      }
    }

    const resolvedAuthPath = authPath || this.getActiveCodexAuthPath()
    let authDebounceTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleAuthCapture = () => {
      if (authDebounceTimer) {
        clearTimeout(authDebounceTimer)
      }
      authDebounceTimer = setTimeout(() => {
        void (async () => {
          try {
            await this.captureLiveAuthForMatchingProfile(resolvedAuthPath)
          } catch {
            // Best-effort capture.
          }
          fire()
        })()
      }, 700)
    }

    disposables.push(
      this.createDisposable(() => {
        if (authDebounceTimer) {
          clearTimeout(authDebounceTimer)
        }
      }),
    )

    const authDir = path.dirname(resolvedAuthPath)
    const authWatcher = this.createFileSystemWatcher(
      this.relativePattern(this.uriFile(authDir), 'auth.json'),
    )
    authWatcher.onDidCreate(scheduleAuthCapture)
    authWatcher.onDidChange(scheduleAuthCapture)
    authWatcher.onDidDelete(fire)
    disposables.push(authWatcher)

    if (this.isRemoteFilesMode()) {
      const profilesWatcher = this.createFileSystemWatcher(
        this.relativePattern(
          this.uriFile(getSharedStoreRoot()),
          PROFILES_FILENAME,
        ),
      )
      profilesWatcher.onDidCreate(fire)
      profilesWatcher.onDidChange(fire)
      profilesWatcher.onDidDelete(fire)
      disposables.push(profilesWatcher)

      const activeWatcher = this.createFileSystemWatcher(
        this.relativePattern(
          this.uriFile(getSharedActiveProfilesDir()),
          '*.json',
        ),
      )
      activeWatcher.onDidCreate(fire)
      activeWatcher.onDidChange(fire)
      activeWatcher.onDidDelete(fire)
      disposables.push(activeWatcher)

      const legacyActiveWatcher = this.createFileSystemWatcher(
        this.relativePattern(
          this.uriFile(getSharedStoreRoot()),
          SHARED_ACTIVE_PROFILE_FILENAME,
        ),
      )
      legacyActiveWatcher.onDidCreate(fire)
      legacyActiveWatcher.onDidChange(fire)
      legacyActiveWatcher.onDidDelete(fire)
      disposables.push(legacyActiveWatcher)

      const tokenWatcher = this.createFileSystemWatcher(
        this.relativePattern(this.uriFile(getSharedProfilesDir()), '*.json'),
      )
      tokenWatcher.onDidCreate(fire)
      tokenWatcher.onDidChange(fire)
      tokenWatcher.onDidDelete(fire)
      disposables.push(tokenWatcher)
    }

    return disposables
  }
}
