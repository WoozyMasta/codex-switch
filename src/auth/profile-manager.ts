import * as vscode from 'vscode'
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
  getSharedProfilesPath,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
} from './shared-profile-store'
import { CodexHomeManager } from '../codex-home/codex-home-manager'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from '../utils/auth-identity'
import { parseImportEntry } from '../utils/import-entry'
import { shouldReplaceStoredProfileAuthWithLive } from '../utils/auth-refresh-policy'
import { parseProfilesFile, type ProfilesFileV1 } from '../utils/profiles-file'
import { parseProfilesFileState } from '../utils/profiles-file-state'
import { matchesPreservationIdentityForProfile } from '../utils/preservation-identity'
import { resolveStorageMode } from '../utils/storage-mode'
import {
  resolveDefaultHomeActiveProfileId,
  resolveSharedActiveProfile,
} from '../utils/shared-active-profile'
import { asOptionalString, firstDefinedString } from '../utils/strings'
import { buildProfileStateKeys } from '../utils/profile-state-keys'
import {
  isNonDefaultPerHomeState,
  shouldMigrateLegacyProfileState,
} from '../utils/profile-state-policy'
import { buildProfileSecretKeys } from '../utils/profile-secret-keys'
import { sha256Text } from '../utils/text-hash'
import {
  buildProfileSummaryFromAuth,
  buildProfileTokensFromAuth,
} from '../utils/profile-records'

type ProfileTokens = Pick<
  AuthData,
  'idToken' | 'accessToken' | 'refreshToken' | 'accountId' | 'authJson'
>

interface ProfilesFileStateMissing {
  kind: 'missing'
  path: string
}

interface ProfilesFileStateValid {
  kind: 'valid'
  path: string
  file: ProfilesFileV1
}

interface ProfilesFileStateCorrupt {
  kind: 'corrupt'
  path: string
  reason: string
}

type ProfilesFileState =
  | ProfilesFileStateMissing
  | ProfilesFileStateValid
  | ProfilesFileStateCorrupt

const PROFILES_FILENAME = 'profiles.json'
const ACTIVE_PROFILE_KEY = 'codexSwitch.activeProfileId'
const LAST_PROFILE_KEY = 'codexSwitch.lastProfileId'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

// Backward compatibility keys (pre-rename).
const OLD_ACTIVE_PROFILE_KEY = 'codexUsage.activeProfileId'
const OLD_LAST_PROFILE_KEY = 'codexUsage.lastProfileId'
interface ExportedProfileEntryV1 {
  profile: ProfileSummary
  tokens: ProfileTokens
}

interface ExportedSettingsV1 {
  format: 'codex-switch-profile-export'
  version: 1
  exportedAt: string
  activeProfileId?: string
  lastProfileId?: string
  profiles: ExportedProfileEntryV1[]
}

interface ImportProfilesResult {
  created: number
  updated: number
  skipped: number
}

interface LiveAuthPreservationResult {
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

interface PrepareForNewLoginChatResult {
  removedAuthFile: boolean
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
export class ProfileManager {
  constructor(
    private context: vscode.ExtensionContext,
    private codexHomeManager: CodexHomeManager,
  ) {}

  private lastSyncedProfileId: string | undefined
  private lastSyncedAuthHash: string | undefined

  private getConfiguredStorageMode(): StorageMode {
    const cfg = vscode.workspace.getConfiguration('codexSwitch')
    const raw = cfg.get<StorageMode>('storageMode', 'auto')
    if (raw === 'secretStorage' || raw === 'remoteFiles' || raw === 'auto') {
      return raw
    }
    return 'auto'
  }

  private getResolvedStorageMode(): Exclude<StorageMode, 'auto'> {
    return resolveStorageMode(
      this.getConfiguredStorageMode(),
      vscode.env.remoteName,
    )
  }

  private isRemoteFilesMode(): boolean {
    return this.getResolvedStorageMode() === 'remoteFiles'
  }

  private asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  private pickNonEmptyString(...values: unknown[]): string | undefined {
    return firstDefinedString(
      ...values.map((value) => this.asNonEmptyString(value)),
    )
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

  private async maybeReplaceProfileAuthWithLive(
    profile: ProfileSummary,
    liveAuth: AuthData,
  ): Promise<boolean> {
    const storedAuth = await this.loadAuthData(profile.id)
    if (!matchesPreservationIdentityForProfile(profile, liveAuth, storedAuth)) {
      return false
    }

    if (!shouldReplaceStoredProfileAuthWithLive(storedAuth, liveAuth)) {
      return false
    }
    return this.replaceProfileAuth(profile.id, liveAuth)
  }

  private async findProfileByPreservationIdentity(
    liveAuth: AuthData,
    preferredProfileId?: string,
  ): Promise<ProfileSummary | undefined> {
    const profiles = await this.listProfiles()
    const orderedProfiles = preferredProfileId
      ? [
          ...profiles.filter((p) => p.id === preferredProfileId),
          ...profiles.filter((p) => p.id !== preferredProfileId),
        ]
      : profiles

    for (const profile of orderedProfiles) {
      const storedAuth = await this.loadAuthData(profile.id)
      if (
        matchesPreservationIdentityForProfile(profile, liveAuth, storedAuth)
      ) {
        return profile
      }
    }
    return undefined
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
      if (!fs.existsSync(authPath)) {
        return undefined
      }
      const content = fs.readFileSync(authPath, 'utf8')
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
    return this.context.globalStorageUri.fsPath
  }

  private getProfilesPath(): string {
    if (this.isRemoteFilesMode()) {
      return getSharedProfilesPath()
    }
    return path.join(this.getStorageDir(), PROFILES_FILENAME)
  }

  private ensureStorageDir() {
    if (this.isRemoteFilesMode()) {
      ensureSharedStoreDirs()
      return
    }

    const dir = this.getStorageDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private async readProfilesFileState(): Promise<ProfilesFileState> {
    this.ensureStorageDir()
    const filePath = this.getProfilesPath()
    if (!fs.existsSync(filePath)) {
      return { kind: 'missing', path: filePath }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return parseProfilesFileState(raw, filePath)
    } catch (error) {
      return {
        kind: 'corrupt',
        path: filePath,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async readProfilesFile(): Promise<ProfilesFileV1> {
    const state = await this.readProfilesFileState()
    if (state.kind === 'valid') {
      return state.file
    }
    if (state.kind === 'corrupt') {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'Profile storage at {0} is corrupted and was not loaded.',
          state.path,
        ),
      )
    }
    return { version: 1, profiles: [] }
  }

  private writeProfilesFile(data: ProfilesFileV1) {
    this.ensureStorageDir()
    writeJsonFile(this.getProfilesPath(), data)
  }

  private async requireWritableProfilesFile(): Promise<ProfilesFileV1 | null> {
    const state = await this.readProfilesFileState()
    if (state.kind === 'corrupt') {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'Profile storage at {0} is corrupted and cannot be modified.',
          state.path,
        ),
      )
      return null
    }

    return state.kind === 'valid' ? state.file : { version: 1, profiles: [] }
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
    if (this.isRemoteFilesMode()) {
      return this.readRemoteProfileTokens(profileId)
    }

    const keys = buildProfileSecretKeys(profileId)
    const raw =
      (await this.context.secrets.get(keys.current)) ||
      (await this.context.secrets.get(keys.legacy))
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as ProfileTokens
    } catch {
      return null
    }
  }

  private async writeStoredTokens(
    profileId: string,
    tokens: ProfileTokens,
  ): Promise<void> {
    if (this.isRemoteFilesMode()) {
      ensureSharedStoreDirs()
      writeJsonFile(getSharedProfileSecretsPath(profileId), tokens)
      return
    }

    const keys = buildProfileSecretKeys(profileId)
    await this.context.secrets.store(keys.current, JSON.stringify(tokens))
  }

  private async deleteStoredTokens(profileId: string): Promise<void> {
    if (this.isRemoteFilesMode()) {
      deleteFileIfExists(getSharedProfileSecretsPath(profileId))
      return
    }

    const keys = buildProfileSecretKeys(profileId)
    await this.context.secrets.delete(keys.current)
    await this.context.secrets.delete(keys.legacy)
  }

  private getGlobalStorageRoot(): string {
    // .../User/globalStorage/<publisher.name> -> .../User/globalStorage
    return path.dirname(this.context.globalStorageUri.fsPath)
  }

  private async tryMigrateLegacyProfilesOnce(): Promise<void> {
    if (this.context.globalState.get<boolean>(MIGRATED_LEGACY_KEY)) {
      return
    }

    const current = await this.readProfilesFile()
    if (current.profiles.length > 0) {
      await this.context.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const root = this.getGlobalStorageRoot()
    if (!fs.existsSync(root)) {
      await this.context.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    const currentDirName = path.basename(this.getStorageDir())
    const candidates: string[] = []

    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
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
      await this.context.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    // Prefer older ids we used during development.
    candidates.sort((a, b) => {
      const rank = (n: string) => {
        if (n.toLowerCase().includes('codex-switch')) {
          return 0
        }
        if (n.toLowerCase().includes('codex-stats')) {
          return 1
        }
        return 2
      }
      return rank(a) - rank(b)
    })

    for (const dirName of candidates) {
      const legacyProfilesPath = path.join(root, dirName, PROFILES_FILENAME)
      if (!fs.existsSync(legacyProfilesPath)) {
        continue
      }

      try {
        const raw = fs.readFileSync(legacyProfilesPath, 'utf8')
        const legacy = parseProfilesFile(raw)
        if (!legacy || legacy.profiles.length === 0) {
          continue
        }

        // Only migrate the profile list. Tokens are stored in SecretStorage and cannot be
        // read across extension ids.
        this.writeProfilesFile({ version: 1, profiles: legacy.profiles })

        void vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Found profiles from a previous install. Please re-import auth.json for each profile to restore tokens.',
          ),
        )
        break
      } catch {
        // keep trying other candidates
      }
    }

    await this.context.globalState.update(MIGRATED_LEGACY_KEY, true)
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    await this.tryMigrateLegacyProfilesOnce()
    const file = await this.readProfilesFile()
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
    const profiles = await this.listProfiles()
    const activeProfileId = await this.getActiveProfileId()
    const lastProfileId = await this.getLastProfileId()

    const exportedProfiles: ExportedProfileEntryV1[] = []
    let skipped = 0

    for (const profile of profiles) {
      const tokens = await this.readStoredTokens(profile.id)
      if (!tokens) {
        skipped += 1
        continue
      }
      exportedProfiles.push({ profile, tokens })
    }

    const data: ExportedSettingsV1 = {
      format: 'codex-switch-profile-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeProfileId,
      lastProfileId,
      profiles: exportedProfiles,
    }

    return { data, skipped }
  }

  async importProfilesFromTransfer(
    value: unknown,
  ): Promise<ImportProfilesResult> {
    const payload = asObject(value)
    if (!payload) {
      throw new Error('Invalid settings file format.')
    }

    const format = asOptionalString(payload.format)
    if (format !== 'codex-switch-profile-export') {
      throw new Error('Unsupported settings file format.')
    }

    if (payload.version !== 1) {
      throw new Error('Unsupported settings export version.')
    }

    if (!Array.isArray(payload.profiles)) {
      throw new Error('Invalid settings file: profiles must be an array.')
    }

    const sourceToTargetId = new Map<string, string>()
    let created = 0
    let updated = 0
    let skipped = 0

    for (const rawEntry of payload.profiles) {
      const parsed = parseImportEntry(rawEntry)
      if (!parsed) {
        skipped += 1
        continue
      }

      const duplicate = await this.findDuplicateProfile(parsed.authData)
      if (duplicate) {
        await this.replaceProfileAuth(duplicate.id, parsed.authData)
        if (parsed.sourceProfileId) {
          sourceToTargetId.set(parsed.sourceProfileId, duplicate.id)
        }
        updated += 1
        continue
      }

      const createdProfile = await this.createProfile(
        parsed.name,
        parsed.authData,
      )
      if (parsed.sourceProfileId) {
        sourceToTargetId.set(parsed.sourceProfileId, createdProfile.id)
      }
      created += 1
    }

    const importedActiveProfileId = asOptionalString(payload.activeProfileId)
    if (importedActiveProfileId) {
      const targetId = sourceToTargetId.get(importedActiveProfileId)
      if (targetId) {
        await this.setActiveProfileId(targetId)
      }
    }

    const importedLastProfileId = asOptionalString(payload.lastProfileId)
    if (importedLastProfileId) {
      const targetId = sourceToTargetId.get(importedLastProfileId)
      if (targetId) {
        await this.setLastProfileId(targetId)
      }
    }

    return { created, updated, skipped }
  }

  private async inferActiveProfileIdFromAuthFile(): Promise<
    string | undefined
  > {
    const authData = await loadAuthDataFromFile(this.getActiveCodexAuthPath())
    if (!authData) {
      return undefined
    }

    const file = await this.readProfilesFile()
    const match = file.profiles.find((p) => this.matchesAuth(p, authData))
    return match?.id
  }

  async findDuplicateProfile(
    authData: AuthData,
  ): Promise<ProfileSummary | undefined> {
    const file = await this.readProfilesFile()
    return file.profiles.find((p) => this.matchesAuth(p, authData))
  }

  private async recoverMissingTokens(
    profileId: string,
  ): Promise<AuthData | null> {
    const profile = await this.getProfile(profileId)
    const recoverLabel = vscode.l10n.t('Recover from remote store')
    const importLabel = vscode.l10n.t('Import current ~/.codex/auth.json')
    const deleteLabel = vscode.l10n.t('Delete broken profile')

    const canRecoverFromRemote =
      !this.isRemoteFilesMode() &&
      this.readRemoteProfileTokens(profileId) != null

    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t(
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
        void vscode.window.showErrorMessage(
          vscode.l10n.t(
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
    const file = await this.requireWritableProfilesFile()
    if (!file) {
      return false
    }
    const idx = file.profiles.findIndex((p) => p.id === profileId)
    if (idx === -1) {
      return false
    }

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
    this.writeProfilesFile(file)

    const tokens = buildProfileTokensFromAuth(authData)
    await this.writeStoredTokens(profileId, tokens)
    return true
  }

  private async maybeSyncToCodexAuthFile(profileId: string): Promise<void> {
    if (!profileId) {
      return
    }
    if (this.lastSyncedProfileId === profileId) {
      return
    }

    const authData = await this.loadAuthData(profileId)
    if (!authData) {
      return
    }

    this.syncProfileAuthToCodexAuthFile(profileId, authData)
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

      await this.maybeReplaceProfileAuthWithLive(profile, liveAuth)
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
    const matchingProfile = await this.findProfileByPreservationIdentity(
      liveAuth,
      activeId,
    )

    if (!matchingProfile) {
      return { status: 'unsaved' }
    }

    await this.maybeReplaceProfileAuthWithLive(matchingProfile, liveAuth)

    return { status: 'saved' }
  }

  private async captureLiveAuthForMatchingProfile(
    authPath: string,
  ): Promise<void> {
    const hash = this.readAuthFileHash(authPath)
    if (!hash) {
      return
    }
    if (hash === this.lastSyncedAuthHash) {
      return
    }

    const liveAuth = await this.loadLiveCodexAuthData()
    if (!liveAuth) {
      return
    }

    const matchingProfile =
      await this.findProfileByPreservationIdentity(liveAuth)
    if (!matchingProfile) {
      return
    }

    await this.maybeReplaceProfileAuthWithLive(matchingProfile, liveAuth)
  }

  async createProfile(
    name: string,
    authData: AuthData,
  ): Promise<ProfileSummary> {
    const file = await this.requireWritableProfilesFile()
    if (!file) {
      throw new Error('Profile storage is corrupted and cannot be modified.')
    }

    const now = new Date().toISOString()
    const id = randomUUID()

    const profile = buildProfileSummaryFromAuth(id, name, authData, now)

    file.profiles.push(profile)
    this.writeProfilesFile(file)

    const tokens = buildProfileTokensFromAuth(authData)
    await this.writeStoredTokens(id, tokens)

    return profile
  }

  async renameProfile(profileId: string, newName: string): Promise<boolean> {
    const file = await this.requireWritableProfilesFile()
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
    this.writeProfilesFile(file)
    return true
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    const file = await this.requireWritableProfilesFile()
    if (!file) {
      return false
    }
    const before = file.profiles.length
    file.profiles = file.profiles.filter((p) => p.id !== profileId)
    if (file.profiles.length === before) {
      return false
    }
    this.writeProfilesFile(file)

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
    const idToken = this.pickNonEmptyString(extracted?.idToken, tokens.idToken)
    const accessToken = this.pickNonEmptyString(
      extracted?.accessToken,
      tokens.accessToken,
    )
    const refreshToken = this.pickNonEmptyString(
      extracted?.refreshToken,
      tokens.refreshToken,
    )
    if (!idToken || !accessToken || !refreshToken) {
      return null
    }
    const emailFromAuth = this.pickNonEmptyString(
      extracted?.email,
      profile.email,
    )
    const planTypeFromAuth = this.pickNonEmptyString(
      extracted?.planType,
      profile.planType,
    )
    if (!emailFromAuth || !planTypeFromAuth) {
      return null
    }

    return {
      idToken,
      accessToken,
      refreshToken,
      accountId: this.pickNonEmptyString(
        extracted?.accountId,
        tokens.accountId,
        profile.accountId,
      ),
      defaultOrganizationId: this.pickNonEmptyString(
        extracted?.defaultOrganizationId,
        profile.defaultOrganizationId,
      ),
      defaultOrganizationTitle: this.pickNonEmptyString(
        extracted?.defaultOrganizationTitle,
        profile.defaultOrganizationTitle,
      ),
      chatgptUserId: this.pickNonEmptyString(
        extracted?.chatgptUserId,
        profile.chatgptUserId,
      ),
      userId: this.pickNonEmptyString(extracted?.userId, profile.userId),
      subject: this.pickNonEmptyString(extracted?.subject, profile.subject),
      email: emailFromAuth,
      planType: planTypeFromAuth,
      authJson: extracted?.authJson ? extracted.authJson : tokens.authJson,
    }
  }

  private getStateBucket(): vscode.Memento {
    const newCfg = vscode.workspace.getConfiguration('codexSwitch')
    const scopeFromNew = newCfg.get<'global' | 'workspace'>(
      'activeProfileScope',
    )
    const scope =
      scopeFromNew ||
      vscode.workspace
        .getConfiguration('codexUsage')
        .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return scope === 'workspace'
      ? this.context.workspaceState
      : this.context.globalState
  }

  private getLegacyStateBucket(): vscode.Memento {
    const scope = vscode.workspace
      .getConfiguration('codexUsage')
      .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return scope === 'workspace'
      ? this.context.workspaceState
      : this.context.globalState
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
    const cfg = vscode.workspace.getConfiguration('codexSwitch')
    return cfg.get<boolean>('codexHome.inheritDefaultProfileWhenEmpty', true)
  }

  private isNonDefaultPerHomeState(): boolean {
    return isNonDefaultPerHomeState(this.getActiveCodexHome())
  }

  private isActiveCodexAuthFileMissing(): boolean {
    return !fs.existsSync(this.getActiveCodexAuthPath())
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

    await this.setActiveProfileIdInState(defaultProfileId)
    return defaultProfileId
  }

  async getActiveProfileId(): Promise<string | undefined> {
    if (this.isRemoteFilesMode()) {
      const explicit = this.readSharedActiveProfile()?.profileId
      const inferred = await this.inferActiveProfileIdFromAuthFile()

      if (inferred) {
        if (explicit !== inferred) {
          this.writeSharedActiveProfile(inferred)
        }
        return inferred
      }

      return explicit || this.inheritDefaultProfileIfCurrentHomeIsEmpty()
    }

    const bucket = this.getStateBucket()
    const activeKey = this.activeProfileKey()
    const v = bucket.get<string>(activeKey)
    if (v) {
      const existing = await this.getProfile(v)
      if (existing) {
        return v
      }

      const inferred = await this.inferActiveProfileIdFromAuthFile()
      if (inferred && inferred !== v) {
        await bucket.update(activeKey, inferred)
        await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        return inferred
      }

      await bucket.update(activeKey, undefined)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return undefined
    }

    if (this.shouldMigrateLegacyProfileState()) {
      // Migrate old key lazily only for the default home. A non-default
      // external CODEX_HOME should not inherit the user's previous global
      // active profile and write it into a fresh auth.json.
      const legacyBucket = this.getLegacyStateBucket()
      const old =
        bucket.get<string>(ACTIVE_PROFILE_KEY) ||
        bucket.get<string>(OLD_ACTIVE_PROFILE_KEY) ||
        legacyBucket.get<string>(OLD_ACTIVE_PROFILE_KEY)
      if (old) {
        const existing = await this.getProfile(old)
        if (existing) {
          await bucket.update(activeKey, old)
          await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
          await bucket.update(ACTIVE_PROFILE_KEY, undefined)
          await legacyBucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
          return old
        }

        const inferred = await this.inferActiveProfileIdFromAuthFile()
        await bucket.update(activeKey, inferred)
        await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        await bucket.update(ACTIVE_PROFILE_KEY, undefined)
        await legacyBucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        return inferred
      }
    }

    const inferred = await this.inferActiveProfileIdFromAuthFile()
    if (inferred) {
      await bucket.update(activeKey, inferred)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return inferred
    }

    return this.inheritDefaultProfileIfCurrentHomeIsEmpty()
  }

  private async setActiveProfileIdInState(
    profileId: string | undefined,
  ): Promise<void> {
    if (this.isRemoteFilesMode()) {
      if (profileId) {
        this.writeSharedActiveProfile(profileId)
      } else {
        this.deleteSharedActiveProfile()
      }
      return
    }

    const bucket = this.getStateBucket()
    await bucket.update(this.activeProfileKey(), profileId)
    await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
  }

  async prepareForNewLoginChat(): Promise<PrepareForNewLoginChatResult> {
    const authPath = this.getActiveCodexAuthPath()

    await this.setActiveProfileIdInState(undefined)
    this.lastSyncedProfileId = undefined
    this.lastSyncedAuthHash = undefined

    if (!fs.existsSync(authPath)) {
      return {
        removedAuthFile: false,
      }
    }

    fs.unlinkSync(authPath)

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

    await this.setActiveProfileIdInState(profileId)

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
    const bucket = this.getStateBucket()
    const lastKey = this.lastProfileKey()
    const v = bucket.get<string>(lastKey)
    if (v) {
      return v
    }

    if (this.shouldMigrateLegacyProfileState()) {
      const legacyBucket = this.getLegacyStateBucket()
      const old =
        bucket.get<string>(LAST_PROFILE_KEY) ||
        bucket.get<string>(OLD_LAST_PROFILE_KEY) ||
        legacyBucket.get<string>(OLD_LAST_PROFILE_KEY)
      if (old) {
        await bucket.update(lastKey, old)
        await bucket.update(OLD_LAST_PROFILE_KEY, undefined)
        await bucket.update(LAST_PROFILE_KEY, undefined)
        await legacyBucket.update(OLD_LAST_PROFILE_KEY, undefined)
        return old
      }
    }
    return undefined
  }

  private async setLastProfileId(profileId: string | undefined): Promise<void> {
    const bucket = this.getStateBucket()
    await bucket.update(this.lastProfileKey(), profileId)
    await bucket.update(OLD_LAST_PROFILE_KEY, undefined)
  }

  async toggleLastProfileId(): Promise<string | undefined> {
    const active = await this.getActiveProfileId()
    const last = await this.getLastProfileId()
    if (!last) {
      return undefined
    }

    const ok = await this.setActiveProfileId(last)
    if (ok && active) {
      // Swap so a second click toggles back.
      await this.setLastProfileId(active)
    }
    return ok ? last : undefined
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
        await this.maybeReplaceProfileAuthWithLive(activeProfile, liveAuth)
        return
      }

      const matched = await this.findProfileByPreservationIdentity(
        liveAuth,
        activeProfile ? activeProfile.id : undefined,
      )
      if (matched) {
        if (activeProfile && activeId && activeId !== matched.id) {
          await this.setLastProfileId(activeId)
        }
        await this.setActiveProfileIdInState(matched.id)
        await this.maybeReplaceProfileAuthWithLive(matched, liveAuth)
        return
      }

      if (activeId) {
        await this.setLastProfileId(activeId)
      }
      await this.setActiveProfileIdInState(undefined)
      return
    }

    if (activeId) {
      await this.maybeSyncToCodexAuthFile(activeId)
    }
  }

  async syncActiveProfileToCodexAuthFile(): Promise<void> {
    const active = await this.getActiveProfileId()
    if (!active) {
      return
    }
    await this.maybeSyncToCodexAuthFile(active)
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
      new vscode.Disposable(() => {
        if (authDebounceTimer) {
          clearTimeout(authDebounceTimer)
        }
      }),
    )

    const authDir = path.dirname(resolvedAuthPath)
    const authWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(authDir), 'auth.json'),
    )
    authWatcher.onDidCreate(scheduleAuthCapture)
    authWatcher.onDidChange(scheduleAuthCapture)
    authWatcher.onDidDelete(fire)
    disposables.push(authWatcher)

    if (this.isRemoteFilesMode()) {
      const profilesWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(getSharedStoreRoot()),
          PROFILES_FILENAME,
        ),
      )
      profilesWatcher.onDidCreate(fire)
      profilesWatcher.onDidChange(fire)
      profilesWatcher.onDidDelete(fire)
      disposables.push(profilesWatcher)

      const activeWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(getSharedActiveProfilesDir()),
          '*.json',
        ),
      )
      activeWatcher.onDidCreate(fire)
      activeWatcher.onDidChange(fire)
      activeWatcher.onDidDelete(fire)
      disposables.push(activeWatcher)

      const legacyActiveWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(getSharedStoreRoot()),
          SHARED_ACTIVE_PROFILE_FILENAME,
        ),
      )
      legacyActiveWatcher.onDidCreate(fire)
      legacyActiveWatcher.onDidChange(fire)
      legacyActiveWatcher.onDidDelete(fire)
      disposables.push(legacyActiveWatcher)

      const tokenWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(getSharedProfilesDir()),
          '*.json',
        ),
      )
      tokenWatcher.onDidCreate(fire)
      tokenWatcher.onDidChange(fire)
      tokenWatcher.onDidDelete(fire)
      disposables.push(tokenWatcher)
    }

    return disposables
  }
}
