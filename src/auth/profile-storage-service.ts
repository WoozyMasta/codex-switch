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

const PROFILES_FILENAME = 'profiles.json'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

interface ProfileStorageServiceDeps {
  fs: SyncFileSystem
  globalState: StateStore
  workspaceState: StateStore
  secrets: SecretStorageStore
  globalStorageUri: vscode.Uri
  isRemoteFilesMode: () => boolean
  getActiveCodexHome: () => ResolvedCodexHome
  showErrorMessage: typeof vscode.window.showErrorMessage
  showInformationMessage: typeof vscode.window.showInformationMessage
  translate: typeof vscode.l10n.t
}

export class ProfileStorageService {
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

  readDefaultHomeSharedActiveProfileId(): string | undefined {
    return readJsonFile<SharedActiveProfile>(
      getSharedActiveProfilePathForHome('default'),
    )?.profileId
  }

  readDefaultHomeSharedLegacyActiveProfileId(): string | undefined {
    return readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
      ?.profileId
  }

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

  deleteSharedActiveProfile(): void {
    if (!this.deps.isRemoteFilesMode()) {
      return
    }
    deleteFileIfExists(
      getSharedActiveProfilePathForHome(this.deps.getActiveCodexHome().id),
    )
  }

  readRemoteProfileTokens(profileId: string): ProfileTokens | null {
    return readJsonFile<ProfileTokens>(getSharedProfileSecretsPath(profileId))
  }

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

  async listProfiles(): Promise<ProfileSummary[]> {
    await this.tryMigrateLegacyProfilesOnce()
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return [...file.profiles].sort((a, b) => a.name.localeCompare(b.name))
  }

  async getProfile(profileId: string): Promise<ProfileSummary | undefined> {
    const profiles = await this.listProfiles()
    return profiles.find((p) => p.id === profileId)
  }

  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    const file = await readProfilesFile(this.profilesFileStorageDeps())
    return file.profiles.find((p) => this.matchesAuth(p, authData))
  }

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
      return true
    })
  }
}
