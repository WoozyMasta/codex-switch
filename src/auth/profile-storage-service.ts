import type * as vscode from 'vscode'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { AuthData, ProfileSummary, ResolvedCodexHome } from '../types'
import {
  extractAuthDataFromAuthJson,
  loadAuthDataFromFile,
} from './auth-manager'
import { parseProfilesFile } from '../utils/profiles-file'
import { resolveProfilesPath } from '../utils/profile-storage-paths'
import {
  getSharedActiveProfilePath,
  getSharedActiveProfilePathForHome,
  getSharedProfileSecretsPath,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
  deleteFileIfExists,
  ensureSharedStoreDirs,
  SharedActiveProfile,
} from './shared-profile-store'
import { resolveSharedActiveProfile } from '../utils/shared-active-profile'
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
import type {
  SecretStorageStore,
  StateStore,
  SyncFileSystem,
} from './runtime-adapters'
import {
  buildProfileSummaryFromAuth,
  buildProfileTokensFromAuth,
  type ProfileTokens,
} from '../utils/profile-records'
import { buildProfileAuthData } from '../utils/profile-auth-data'
import { buildProfileSecretKeys } from '../utils/profile-secret-keys'
import { findMatchingProfileIdForAuth } from '../utils/profile-auth-match'
import { sortLegacyProfileMigrationCandidates } from '../utils/legacy-profile-migration'
import { matchesPreservationIdentityForProfile } from '../utils/preservation-identity'
import {
  getAuthLastRefresh,
  shouldReplaceStoredProfileAuthWithLive,
} from '../utils/auth-refresh-policy'
import { getCanonicalTokenBundle } from '../utils/auth-payload'

const PROFILES_FILENAME = 'profiles.json'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

/**
 * Outcome of an attempt to replace a profile's authentication with newer credentials.
 * - 'updated': Auth was successfully replaced.
 * - 'unchanged': Auth was not replaced because it is already current.
 * - 'conflict': Auth was not replaced due to a concurrent modification or identity mismatch.
 * - 'missing': Profile not found.
 * - 'failed': Write operation failed.
 */
export type ProfileAuthReplacementOutcome =
  | 'updated'
  | 'unchanged'
  | 'conflict'
  | 'missing'
  | 'failed'

/**
 * Dependencies for ProfileStorageService.
 */
interface ProfileStorageServiceDeps {
  /** File system operations adapter. */
  fs: SyncFileSystem
  /** Global VS Code state storage. */
  globalState: StateStore
  /** Workspace-level VS Code state storage. */
  workspaceState: StateStore
  /** Secure storage for sensitive authentication data. */
  secrets: SecretStorageStore
  /** URI to the global storage directory. */
  globalStorageUri: vscode.Uri
  /** Function indicating whether remote files mode is enabled. */
  isRemoteFilesMode: () => boolean
  /** Function to get the active Codex home configuration. */
  getActiveCodexHome: () => ResolvedCodexHome
  /** Function to show error messages in the UI. */
  showErrorMessage: typeof vscode.window.showErrorMessage
  /** Function to show informational messages in the UI. */
  showInformationMessage: typeof vscode.window.showInformationMessage
  /** Function to translate localized strings. */
  translate: typeof vscode.l10n.t
}

/**
 * Manages persistent storage and retrieval of user profiles and their authentication data.
 * Handles multiple storage modes (local and remote), profile CRUD operations, and token management.
 */
export class ProfileStorageService {
  /**
   * Creates a new ProfileStorageService instance.
   * @param deps - Dependencies including file system, state stores, and messaging functions.
   */
  constructor(private readonly deps: ProfileStorageServiceDeps) {}

  private getStorageDir(): string {
    if (this.deps.isRemoteFilesMode()) {
      return getSharedStoreRoot()
    }
    return this.deps.globalStorageUri.fsPath
  }

  private getProfilesPath(): string {
    return resolveProfilesPath(
      this.deps.isRemoteFilesMode(),
      this.getStorageDir(),
    )
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
      writeJsonFile: (path, data) => writeJsonFile(path, data),
      showReadErrorMessage: (path) =>
        void this.deps.showErrorMessage(
          this.deps.translate(
            'Profile storage at {0} is corrupted and was not loaded.',
            path,
          ),
        ),
      showWriteErrorMessage: (path) =>
        void this.deps.showErrorMessage(
          this.deps.translate(
            'Profile storage at {0} is corrupted and cannot be modified.',
            path,
          ),
        ),
    }
  }

  private ensureStorageDir(): void {
    if (this.deps.isRemoteFilesMode()) {
      ensureSharedStoreDirs()
      return
    }

    const dir = this.getStorageDir()
    if (!this.deps.fs.existsSync(dir)) {
      this.deps.fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Reads the shared active profile marker from remote storage.
   * Only applicable in remote files mode.
   * @returns The shared active profile data, or null if not in remote mode or file not found.
   */
  readSharedActiveProfile(): SharedActiveProfile | null {
    if (!this.deps.isRemoteFilesMode()) {
      return null
    }
    const home = this.deps.getActiveCodexHome()
    return resolveSharedActiveProfile(
      readJsonFile<SharedActiveProfile>(
        getSharedActiveProfilePathForHome(home.id),
      ),
      readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath()),
      home.isDefault,
    )
  }

  /**
   * Reads the active profile ID from the default home's shared state.
   * Only applicable in remote files mode.
   * @returns The active profile ID from the default home, or undefined if not found.
   */
  readDefaultHomeSharedActiveProfileId(): string | undefined {
    return readJsonFile<SharedActiveProfile>(
      getSharedActiveProfilePathForHome('default'),
    )?.profileId
  }

  /**
   * Reads the legacy active profile ID from the global shared state.
   * Only applicable in remote files mode.
   * @returns The legacy active profile ID, or undefined if not found.
   */
  readDefaultHomeSharedLegacyActiveProfileId(): string | undefined {
    return readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
      ?.profileId
  }

  /**
   * Writes the active profile marker to remote shared storage.
   * Only applicable in remote files mode.
   * @param profileId - The ID of the profile to mark as active.
   */
  writeSharedActiveProfile(profileId: string): void {
    if (!this.deps.isRemoteFilesMode()) {
      return
    }
    writeJsonFile(
      getSharedActiveProfilePathForHome(this.deps.getActiveCodexHome().id),
      {
        profileId,
        updatedAt: new Date().toISOString(),
      } satisfies SharedActiveProfile,
    )
  }

  /**
   * Deletes the active profile marker from remote shared storage.
   * Only applicable in remote files mode.
   */
  deleteSharedActiveProfile(): void {
    if (!this.deps.isRemoteFilesMode()) {
      return
    }
    deleteFileIfExists(
      getSharedActiveProfilePathForHome(this.deps.getActiveCodexHome().id),
    )
  }

  /**
   * Reads stored authentication tokens from remote shared storage for a profile.
   * @param profileId - The ID of the profile.
   * @returns The stored tokens, or null if not found or not in remote mode.
   */
  readRemoteProfileTokens(profileId: string): ProfileTokens | null {
    return readJsonFile<ProfileTokens>(getSharedProfileSecretsPath(profileId))
  }

  /**
   * Reads stored authentication tokens for a profile from either local or remote storage.
   * @param profileId - The ID of the profile.
   * @returns A promise that resolves to the stored tokens, or null if not found.
   */
  async readStoredTokens(profileId: string): Promise<ProfileTokens | null> {
    return readStoredProfileTokens(
      {
        isRemoteFilesMode: this.deps.isRemoteFilesMode(),
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

  async writeStoredTokens(
    profileId: string,
    tokens: ProfileTokens,
  ): Promise<void> {
    await writeStoredProfileTokens(
      {
        isRemoteFilesMode: this.deps.isRemoteFilesMode(),
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

  async deleteStoredTokens(profileId: string): Promise<void> {
    await deleteStoredProfileTokens(
      {
        isRemoteFilesMode: this.deps.isRemoteFilesMode(),
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

  private writeRemoteProfileTokens(profileId: string, tokens: any): void {
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
      (await this.deps.secrets.get(keys.current)) ||
      (await this.deps.secrets.get(keys.legacy))
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
    await this.deps.secrets.store(keys.current, JSON.stringify(tokens))
  }

  private async deleteLocalStoredTokens(profileId: string): Promise<void> {
    const keys = buildProfileSecretKeys(profileId)
    await this.deps.secrets.delete(keys.current)
    await this.deps.secrets.delete(keys.legacy)
  }

  private getGlobalStorageRoot(): string {
    return path.dirname(this.deps.globalStorageUri.fsPath)
  }

  private async tryMigrateLegacyProfilesOnce(): Promise<void> {
    if (this.deps.globalState.get<boolean>(MIGRATED_LEGACY_KEY)) {
      return
    }

    const current = await readProfilesFile(this.profilesFileStorageDeps())
    if (current.profiles.length > 0) {
      await this.deps.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const root = this.getGlobalStorageRoot()
    if (!this.deps.fs.existsSync(root)) {
      await this.deps.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const currentDirName = path.basename(this.getStorageDir())
    const candidates: string[] = []

    try {
      const entries = this.deps.fs.readdirSync(root, { withFileTypes: true })
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
      await this.deps.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    candidates.splice(
      0,
      candidates.length,
      ...sortLegacyProfileMigrationCandidates(candidates),
    )

    for (const dirName of candidates) {
      const legacyProfilesPath = path.join(root, dirName, PROFILES_FILENAME)
      if (!this.deps.fs.existsSync(legacyProfilesPath)) {
        continue
      }

      try {
        const raw = this.deps.fs.readFileSync(legacyProfilesPath, 'utf8')
        const legacy = parseProfilesFile(raw)
        if (!legacy || legacy.profiles.length === 0) {
          continue
        }

        writeProfilesFile(this.profilesFileStorageDeps(), {
          version: 1,
          profiles: legacy.profiles,
        })

        void this.deps.showInformationMessage(
          this.deps.translate(
            'Found profiles from a previous install. Please re-import auth.json for each profile to restore tokens.',
          ),
        )
        break
      } catch {
        // keep trying other candidates
      }
    }

    await this.deps.globalState.update(MIGRATED_LEGACY_KEY, true)
  }

  /**
   * Lists all stored profiles sorted by name.
   * Triggers legacy profile migration on first call.
   * @returns A promise that resolves to an array of profile summaries.
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    await this.tryMigrateLegacyProfilesOnce()
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return [...file.profiles].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Retrieves a specific profile by ID.
   * @param profileId - The ID of the profile to retrieve.
   * @returns A promise that resolves to the profile summary, or undefined if not found.
   */
  async getProfile(profileId: string): Promise<ProfileSummary | undefined> {
    const profiles = await this.listProfiles()
    return profiles.find((p) => p.id === profileId)
  }

  /**
   * Finds an existing profile that matches the given authentication data.
   * Matches on identity fields like email, account ID, and organization.
   * @param authData - The authentication data to search for.
   * @returns A promise that resolves to a matching profile summary, or undefined if not found.
   */
  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return file.profiles.find((p) => this.matchesAuth(p, authData))
  }

  /**
   * Infers the profile ID matching an authentication file.
   * @param authPath - The path to an auth.json file.
   * @returns A promise that resolves to the matching profile ID, or undefined if not found.
   */
  async inferActiveProfileIdFromAuthFile(
    authPath: string,
  ): Promise<string | undefined> {
    const authData = await loadAuthDataFromFile(authPath)
    if (!authData) {
      return undefined
    }

    const profiles = await this.listProfiles()
    return findMatchingProfileIdForAuth(profiles, authData)
  }

  /**
   * Loads the full authentication data for a profile.
   * @param profileId - The ID of the profile.
   * @returns A promise that resolves to the auth data, or null if not found or tokens missing.
   */
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

  private matchesAuth(profile: ProfileSummary, authData: AuthData): boolean {
    return (
      profile.email === authData.email &&
      profile.planType === authData.planType &&
      profile.accountId === authData.accountId &&
      profile.defaultOrganizationId === authData.defaultOrganizationId &&
      profile.defaultOrganizationTitle === authData.defaultOrganizationTitle &&
      profile.chatgptUserId === authData.chatgptUserId &&
      profile.userId === authData.userId &&
      profile.subject === authData.subject
    )
  }

  /**
   * Replaces the authentication data for a profile with new credentials.
   * Uses file locking to ensure atomic updates.
   * @param profileId - The ID of the profile to update.
   * @param authData - The new authentication data.
   * @returns A promise that resolves to true if the replacement succeeded, false otherwise.
   */
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

  /**
   * Conditionally persist auth that Codex refreshed in a temporary home back
   * into the saved profile. Reuses the existing identity and freshness policies
   * and the durable, locked `replaceProfileAuth` write. Token comparison stays
   * in process memory; nothing about the tokens is recorded elsewhere.
   *
   * `baselineAuth` is the auth that was loaded to start Codex; it is used to
   * detect a concurrent mutation (import, switch, delete) of the stored auth
   * while maintenance was running.
   */
  async replaceProfileAuthIfFresher(
    profileId: string,
    refreshedAuth: AuthData,
    baselineAuth: AuthData,
  ): Promise<ProfileAuthReplacementOutcome> {
    const profile = await this.getProfile(profileId)
    if (!profile) {
      return 'missing'
    }

    if (!getCanonicalTokenBundle(refreshedAuth)) {
      return 'conflict'
    }

    const currentAuth = await this.loadAuthData(profileId)

    // Identity must unambiguously match the intended profile (org included).
    if (
      !matchesPreservationIdentityForProfile(
        profile,
        refreshedAuth,
        currentAuth,
      )
    ) {
      return 'conflict'
    }

    // Not older than current, and tokens / last_refresh actually changed.
    if (!shouldReplaceStoredProfileAuthWithLive(currentAuth, refreshedAuth)) {
      return 'unchanged'
    }

    // Concurrent mutation: stored auth changed versus the baseline used to
    // start Codex. Only override it when refreshed auth is strictly newer.
    if (currentAuth && authTokensDiffer(currentAuth, baselineAuth)) {
      const currentRefresh = getAuthLastRefresh(currentAuth)
      const refreshedRefresh = getAuthLastRefresh(refreshedAuth)
      if (
        currentRefresh === undefined ||
        refreshedRefresh === undefined ||
        refreshedRefresh <= currentRefresh
      ) {
        return 'conflict'
      }
    }

    try {
      const written = await this.replaceProfileAuth(profileId, refreshedAuth)
      return written ? 'updated' : 'missing'
    } catch {
      return 'failed'
    }
  }

  /**
   * Creates a new profile with the given name and authentication data.
   * Generates a unique ID and timestamp for the profile.
   * @param name - The display name for the profile.
   * @param authData - The authentication data for the profile.
   * @returns A promise that resolves to the created profile summary.
   */
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

  /**
   * Renames an existing profile.
   * Updates the modification timestamp.
   * @param profileId - The ID of the profile to rename.
   * @param newName - The new display name for the profile.
   * @returns A promise that resolves to true if the rename succeeded, false otherwise.
   */
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

  /**
   * Deletes a profile and its associated authentication data.
   * Removes both the profile record and stored tokens.
   * @param profileId - The ID of the profile to delete.
   * @returns A promise that resolves to true if the deletion succeeded, false otherwise.
   */
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
      return true
    })
  }
}

/**
 * Compares the token bundles of two authentication data objects.
 * @param a - The first authentication data.
 * @param b - The second authentication data.
 * @returns True if the tokens differ between the two auth data objects.
 * @internal
 */
function authTokensDiffer(a: AuthData, b: AuthData): boolean {
  const tokensA = getCanonicalTokenBundle(a)
  const tokensB = getCanonicalTokenBundle(b)
  if (!tokensA || !tokensB) {
    return true
  }
  return (
    tokensA.idToken !== tokensB.idToken ||
    tokensA.accessToken !== tokensB.accessToken ||
    tokensA.refreshToken !== tokensB.refreshToken
  )
}
