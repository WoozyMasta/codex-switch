import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { AuthData, ProfileSummary, StorageMode } from '../types'
import { getDefaultCodexAuthPath, loadAuthDataFromFile } from './auth-manager'
import { syncCodexAuthFile } from './codex-auth-sync'
import {
  SharedActiveProfile,
  SHARED_ACTIVE_PROFILE_FILENAME,
  deleteFileIfExists,
  ensureSharedStoreDirs,
  getSharedActiveProfilePath,
  getSharedProfileSecretsPath,
  getSharedProfilesDir,
  getSharedProfilesPath,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
} from './shared-profile-store'

type ProfileTokens = Pick<
  AuthData,
  'idToken' | 'accessToken' | 'refreshToken' | 'accountId' | 'authJson'
>

interface ProfilesFileV1 {
  version: 1
  profiles: ProfileSummary[]
}

const PROFILES_FILENAME = 'profiles.json'
const ACTIVE_PROFILE_KEY = 'codexSwitch.activeProfileId'
const LAST_PROFILE_KEY = 'codexSwitch.lastProfileId'
const MIGRATED_LEGACY_KEY = 'codexSwitch.migratedLegacyProfiles'

// Backward compatibility keys (pre-rename).
const OLD_ACTIVE_PROFILE_KEY = 'codexUsage.activeProfileId'
const OLD_LAST_PROFILE_KEY = 'codexUsage.lastProfileId'
const OLD_SECRET_PREFIX = 'codexUsage.profile.'
const NEW_SECRET_PREFIX = 'codexSwitch.profile.'

export class ProfileManager {
  constructor(private context: vscode.ExtensionContext) {}

  private lastSyncedProfileId: string | undefined

  private getConfiguredStorageMode(): StorageMode {
    const cfg = vscode.workspace.getConfiguration('codexSwitch')
    const raw = cfg.get<StorageMode>('storageMode', 'auto')
    if (raw === 'secretStorage' || raw === 'remoteFiles' || raw === 'auto') {
      return raw
    }
    return 'auto'
  }

  private getResolvedStorageMode(): Exclude<StorageMode, 'auto'> {
    const configured = this.getConfiguredStorageMode()
    if (configured === 'auto') {
      return vscode.env.remoteName === 'ssh-remote'
        ? 'remoteFiles'
        : 'secretStorage'
    }
    return configured
  }

  private isRemoteFilesMode(): boolean {
    return this.getResolvedStorageMode() === 'remoteFiles'
  }

  private getMaxAuthBackups(): number {
    const cfg = vscode.workspace.getConfiguration('codexSwitch')
    const raw = cfg.get<number>('maxAuthBackups', 10)
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) return 10
    return Math.max(0, Math.floor(n))
  }

  private normalizeEmail(email: string | undefined): string {
    return String(email || '').trim().toLowerCase()
  }

  private normalizeIdentity(value: string | undefined): string {
    return String(value || '').trim()
  }

  private compareIdentityField(
    profileValue: string | undefined,
    authValue: string | undefined,
  ): boolean | undefined {
    const p = this.normalizeIdentity(profileValue)
    const a = this.normalizeIdentity(authValue)
    if (!p || !a) return undefined
    return p === a
  }

  private matchesAuth(profile: ProfileSummary, authData: AuthData): boolean {
    // Team/Business tenants can share account_id across different users.
    // Match by user identity fields first, then email as a final fallback.
    const chatgptUserIdMatch = this.compareIdentityField(
      profile.chatgptUserId,
      authData.chatgptUserId,
    )
    if (chatgptUserIdMatch !== undefined) return chatgptUserIdMatch

    const userIdMatch = this.compareIdentityField(profile.userId, authData.userId)
    if (userIdMatch !== undefined) return userIdMatch

    const subjectMatch = this.compareIdentityField(profile.subject, authData.subject)
    if (subjectMatch !== undefined) return subjectMatch

    const pe = this.normalizeEmail(profile.email)
    const ae = this.normalizeEmail(authData.email)
    const hasComparableEmail =
      Boolean(pe) &&
      Boolean(ae) &&
      pe !== 'unknown' &&
      ae !== 'unknown'
    const hasComparableAccountId =
      Boolean(authData.accountId) && Boolean(profile.accountId)

    // When both identifiers are present, require both to match.
    // Team accounts can share accountId across different users, and the same
    // email can legitimately have multiple plans/accounts.
    if (hasComparableEmail && hasComparableAccountId) {
      return pe === ae && authData.accountId === profile.accountId
    }

    if (hasComparableEmail) {
      return pe === ae
    }

    if (hasComparableAccountId) {
      return authData.accountId === profile.accountId
    }

    return false
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

  private parseProfilesFile(raw: string): ProfilesFileV1 {
    const parsed: any = JSON.parse(raw)

    // Legacy format: plain array of profiles.
    if (Array.isArray(parsed)) {
      return { version: 1, profiles: parsed as ProfileSummary[] }
    }

    // Legacy format: { profiles: [...] } without a version.
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles)) {
      return { version: 1, profiles: parsed.profiles as ProfileSummary[] }
    }

    // Current format: { version: 1, profiles: [...] }
    if (parsed && parsed.version === 1 && Array.isArray(parsed.profiles)) {
      return { version: 1, profiles: parsed.profiles as ProfileSummary[] }
    }

    return { version: 1, profiles: [] }
  }

  private async readProfilesFile(): Promise<ProfilesFileV1> {
    this.ensureStorageDir()
    const filePath = this.getProfilesPath()
    if (!fs.existsSync(filePath)) {
      return { version: 1, profiles: [] }
    }

    try {
      if (this.isRemoteFilesMode()) {
        const parsed = readJsonFile<any>(filePath)
        if (parsed == null) return { version: 1, profiles: [] }
        return this.parseProfilesFile(JSON.stringify(parsed))
      }
      const raw = fs.readFileSync(filePath, 'utf8')
      return this.parseProfilesFile(raw)
    } catch {
      // If corrupted, don't crash the extension.
      return { version: 1, profiles: [] }
    }
  }

  private writeProfilesFile(data: ProfilesFileV1) {
    this.ensureStorageDir()
    if (this.isRemoteFilesMode()) {
      writeJsonFile(this.getProfilesPath(), data)
      return
    }

    fs.writeFileSync(this.getProfilesPath(), JSON.stringify(data, null, 2), {
      encoding: 'utf8',
    })
  }

  private secretKey(profileId: string): string {
    return `${NEW_SECRET_PREFIX}${profileId}`
  }

  private legacySecretKey(profileId: string): string {
    return `${OLD_SECRET_PREFIX}${profileId}`
  }

  private readSharedActiveProfile(): SharedActiveProfile | null {
    if (!this.isRemoteFilesMode()) return null
    return readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
  }

  private writeSharedActiveProfile(profileId: string): void {
    if (!this.isRemoteFilesMode()) return
    writeJsonFile(getSharedActiveProfilePath(), {
      profileId,
      updatedAt: new Date().toISOString(),
    } satisfies SharedActiveProfile)
  }

  private deleteSharedActiveProfile(): void {
    if (!this.isRemoteFilesMode()) return
    deleteFileIfExists(getSharedActiveProfilePath())
  }

  private readRemoteProfileTokens(profileId: string): ProfileTokens | null {
    return readJsonFile<ProfileTokens>(getSharedProfileSecretsPath(profileId))
  }

  private async readStoredTokens(profileId: string): Promise<ProfileTokens | null> {
    if (this.isRemoteFilesMode()) {
      return this.readRemoteProfileTokens(profileId)
    }

    const raw =
      (await this.context.secrets.get(this.secretKey(profileId))) ||
      (await this.context.secrets.get(this.legacySecretKey(profileId)))
    if (!raw) return null

    try {
      return JSON.parse(raw) as ProfileTokens
    } catch {
      return null
    }
  }

  private async writeStoredTokens(profileId: string, tokens: ProfileTokens): Promise<void> {
    if (this.isRemoteFilesMode()) {
      ensureSharedStoreDirs()
      writeJsonFile(getSharedProfileSecretsPath(profileId), tokens)
      return
    }

    await this.context.secrets.store(this.secretKey(profileId), JSON.stringify(tokens))
  }

  private async deleteStoredTokens(profileId: string): Promise<void> {
    if (this.isRemoteFilesMode()) {
      deleteFileIfExists(getSharedProfileSecretsPath(profileId))
      return
    }

    await this.context.secrets.delete(this.secretKey(profileId))
    await this.context.secrets.delete(this.legacySecretKey(profileId))
  }

  private getGlobalStorageRoot(): string {
    // .../User/globalStorage/<publisher.name> -> .../User/globalStorage
    return path.dirname(this.context.globalStorageUri.fsPath)
  }

  private async tryMigrateLegacyProfilesOnce(): Promise<void> {
    if (this.context.globalState.get<boolean>(MIGRATED_LEGACY_KEY)) return

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
        if (!e.isDirectory()) continue
        const name = e.name
        if (name === currentDirName) continue
        if (!name.endsWith('.codex-switch') && !name.endsWith('.codex-stats')) continue
        candidates.push(name)
      }
    } catch {
      await this.context.globalState.update(MIGRATED_LEGACY_KEY, true)
      return
    }

    // Prefer older ids we used during development.
    candidates.sort((a, b) => {
      const rank = (n: string) => {
        if (n.toLowerCase().includes('codex-switch')) return 0
        if (n.toLowerCase().includes('codex-stats')) return 1
        return 2
      }
      return rank(a) - rank(b)
    })

    for (const dirName of candidates) {
      const legacyProfilesPath = path.join(root, dirName, PROFILES_FILENAME)
      if (!fs.existsSync(legacyProfilesPath)) continue

      try {
        const raw = fs.readFileSync(legacyProfilesPath, 'utf8')
        const legacy = this.parseProfilesFile(raw)
        if (!legacy.profiles || legacy.profiles.length === 0) continue

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

  private async inferActiveProfileIdFromAuthFile(): Promise<string | undefined> {
    const authData = await loadAuthDataFromFile(getDefaultCodexAuthPath())
    if (!authData) return undefined

    const file = await this.readProfilesFile()
    const match = file.profiles.find((p) => this.matchesAuth(p, authData))
    return match?.id
  }

  async findDuplicateProfile(authData: AuthData): Promise<ProfileSummary | undefined> {
    const file = await this.readProfilesFile()
    return file.profiles.find((p) => this.matchesAuth(p, authData))
  }

  private async recoverMissingTokens(profileId: string): Promise<AuthData | null> {
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
      const authData = await loadAuthDataFromFile(getDefaultCodexAuthPath())
      if (!authData) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t(
            'Could not read auth from {0}. Run "codex login" first.',
            getDefaultCodexAuthPath(),
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

  async replaceProfileAuth(profileId: string, authData: AuthData): Promise<boolean> {
    const file = await this.readProfilesFile()
    const idx = file.profiles.findIndex((p) => p.id === profileId)
    if (idx === -1) return false

    file.profiles[idx] = {
      ...file.profiles[idx],
      email: authData.email,
      planType: authData.planType,
      accountId: authData.accountId,
      chatgptUserId: authData.chatgptUserId,
      userId: authData.userId,
      subject: authData.subject,
      updatedAt: new Date().toISOString(),
    }
    this.writeProfilesFile(file)

    const tokens: ProfileTokens = {
      idToken: authData.idToken,
      accessToken: authData.accessToken,
      refreshToken: authData.refreshToken,
      accountId: authData.accountId,
      authJson: authData.authJson,
    }
    await this.writeStoredTokens(profileId, tokens)
    return true
  }

  private async maybeSyncToCodexAuthFile(profileId: string): Promise<void> {
    if (!profileId) return
    if (this.lastSyncedProfileId === profileId) return

    const authData = await this.loadAuthData(profileId)
    if (!authData) return

    syncCodexAuthFile(getDefaultCodexAuthPath(), authData, {
      maxBackups: this.getMaxAuthBackups(),
    })
    this.lastSyncedProfileId = profileId
  }

  async createProfile(name: string, authData: AuthData): Promise<ProfileSummary> {
    const now = new Date().toISOString()
    const id = randomUUID()

    const profile: ProfileSummary = {
      id,
      name,
      email: authData.email,
      planType: authData.planType,
      accountId: authData.accountId,
      chatgptUserId: authData.chatgptUserId,
      userId: authData.userId,
      subject: authData.subject,
      createdAt: now,
      updatedAt: now,
    }

    const file = await this.readProfilesFile()
    file.profiles.push(profile)
    this.writeProfilesFile(file)

    const tokens: ProfileTokens = {
      idToken: authData.idToken,
      accessToken: authData.accessToken,
      refreshToken: authData.refreshToken,
      accountId: authData.accountId,
      authJson: authData.authJson,
    }
    await this.writeStoredTokens(id, tokens)

    return profile
  }

  async renameProfile(profileId: string, newName: string): Promise<boolean> {
    const file = await this.readProfilesFile()
    const idx = file.profiles.findIndex((p) => p.id === profileId)
    if (idx === -1) return false
    file.profiles[idx] = {
      ...file.profiles[idx],
      name: newName,
      updatedAt: new Date().toISOString(),
    }
    this.writeProfilesFile(file)
    return true
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    const file = await this.readProfilesFile()
    const before = file.profiles.length
    file.profiles = file.profiles.filter((p) => p.id !== profileId)
    if (file.profiles.length === before) return false
    this.writeProfilesFile(file)

    await this.deleteStoredTokens(profileId)

    // Clean up active/last if they point to deleted profile.
    const active = await this.getActiveProfileId()
    const last = await this.getLastProfileId()
    if (active === profileId) await this.setActiveProfileId(undefined)
    if (last === profileId) await this.setLastProfileId(undefined)
    return true
  }

  async loadAuthData(profileId: string): Promise<AuthData | null> {
    const profile = await this.getProfile(profileId)
    if (!profile) return null

    const tokens = await this.readStoredTokens(profileId)
    if (!tokens) return null

    return {
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId || profile.accountId,
      chatgptUserId: profile.chatgptUserId,
      userId: profile.userId,
      subject: profile.subject,
      email: profile.email,
      planType: profile.planType,
      authJson: tokens.authJson,
    }
  }

  private getStateBucket(): vscode.Memento {
    const newCfg = vscode.workspace.getConfiguration('codexSwitch')
    const scopeFromNew = newCfg.get<'global' | 'workspace'>('activeProfileScope')
    const scope =
      scopeFromNew ||
      vscode.workspace
        .getConfiguration('codexUsage')
        .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return scope === 'workspace' ? this.context.workspaceState : this.context.globalState
  }

  private getLegacyStateBucket(): vscode.Memento {
    const scope = vscode.workspace
      .getConfiguration('codexUsage')
      .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return scope === 'workspace' ? this.context.workspaceState : this.context.globalState
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

      return explicit
    }

    const bucket = this.getStateBucket()
    const v = bucket.get<string>(ACTIVE_PROFILE_KEY)
    if (v) return v

    // Migrate old key lazily.
    const legacyBucket = this.getLegacyStateBucket()
    const old =
      bucket.get<string>(OLD_ACTIVE_PROFILE_KEY) ||
      legacyBucket.get<string>(OLD_ACTIVE_PROFILE_KEY)
    if (old) {
      await bucket.update(ACTIVE_PROFILE_KEY, old)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      await legacyBucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return old
    }
    return undefined
  }

  async setActiveProfileId(profileId: string | undefined): Promise<boolean> {
    const bucket = this.getStateBucket()
    const prev =
      (this.isRemoteFilesMode()
        ? await this.getActiveProfileId()
        : bucket.get<string>(ACTIVE_PROFILE_KEY) ||
          bucket.get<string>(OLD_ACTIVE_PROFILE_KEY))

    let authData: AuthData | null = null
    if (profileId) {
      authData = await this.loadAuthData(profileId)
      if (!authData) {
        authData = await this.recoverMissingTokens(profileId)
        if (!authData) return false
      }
    }

    if (prev && profileId && prev !== profileId) {
      await this.setLastProfileId(prev)
    }

    if (this.isRemoteFilesMode()) {
      if (profileId) {
        this.writeSharedActiveProfile(profileId)
      } else {
        this.deleteSharedActiveProfile()
      }
    } else {
      await bucket.update(ACTIVE_PROFILE_KEY, profileId)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
    }

    if (profileId && authData) {
      // We already validated tokens above; avoid a second secret read.
      syncCodexAuthFile(getDefaultCodexAuthPath(), authData, {
        maxBackups: this.getMaxAuthBackups(),
      })
      this.lastSyncedProfileId = profileId
    }
    return true
  }

  async getLastProfileId(): Promise<string | undefined> {
    const bucket = this.getStateBucket()
    const v = bucket.get<string>(LAST_PROFILE_KEY)
    if (v) return v

    const legacyBucket = this.getLegacyStateBucket()
    const old =
      bucket.get<string>(OLD_LAST_PROFILE_KEY) ||
      legacyBucket.get<string>(OLD_LAST_PROFILE_KEY)
    if (old) {
      await bucket.update(LAST_PROFILE_KEY, old)
      await bucket.update(OLD_LAST_PROFILE_KEY, undefined)
      await legacyBucket.update(OLD_LAST_PROFILE_KEY, undefined)
      return old
    }
    return undefined
  }

  private async setLastProfileId(profileId: string | undefined): Promise<void> {
    const bucket = this.getStateBucket()
    await bucket.update(LAST_PROFILE_KEY, profileId)
    await bucket.update(OLD_LAST_PROFILE_KEY, undefined)
  }

  async toggleLastProfileId(): Promise<string | undefined> {
    const active = await this.getActiveProfileId()
    const last = await this.getLastProfileId()
    if (!last) return undefined

    const ok = await this.setActiveProfileId(last)
    if (ok && active) {
      // Swap so a second click toggles back.
      await this.setLastProfileId(active)
    }
    return ok ? last : undefined
  }

  async syncActiveProfileToCodexAuthFile(): Promise<void> {
    const active = await this.getActiveProfileId()
    if (!active) return
    await this.maybeSyncToCodexAuthFile(active)
  }

  createWatchers(onChanged: () => void): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = []
    const fire = () => {
      try {
        onChanged()
      } catch {
        // ignore refresh errors from file watchers
      }
    }

    const authDir = path.dirname(getDefaultCodexAuthPath())
    const authWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(authDir), 'auth.json'),
    )
    authWatcher.onDidCreate(fire)
    authWatcher.onDidChange(fire)
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
          vscode.Uri.file(getSharedStoreRoot()),
          SHARED_ACTIVE_PROFILE_FILENAME,
        ),
      )
      activeWatcher.onDidCreate(fire)
      activeWatcher.onDidChange(fire)
      activeWatcher.onDidDelete(fire)
      disposables.push(activeWatcher)

      const tokenWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(getSharedProfilesDir()), '*.json'),
      )
      tokenWatcher.onDidCreate(fire)
      tokenWatcher.onDidChange(fire)
      tokenWatcher.onDidDelete(fire)
      disposables.push(tokenWatcher)
    }

    return disposables
  }
}
