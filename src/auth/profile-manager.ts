import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { AuthData, ProfileSummary } from '../types'
import { getDefaultCodexAuthPath } from './auth-manager'
import { syncCodexAuthFile } from './codex-auth-sync'

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

  private normalizeEmail(email: string | undefined): string {
    return String(email || '').trim().toLowerCase()
  }

  private matchesAuth(profile: ProfileSummary, authData: AuthData): boolean {
    if (authData.accountId && profile.accountId && authData.accountId === profile.accountId) {
      return true
    }

    const pe = this.normalizeEmail(profile.email)
    const ae = this.normalizeEmail(authData.email)
    if (!pe || !ae) return false
    if (pe === 'unknown' || ae === 'unknown') return false
    return pe === ae
  }

  private getStorageDir(): string {
    return this.context.globalStorageUri.fsPath
  }

  private getProfilesPath(): string {
    return path.join(this.getStorageDir(), PROFILES_FILENAME)
  }

  private ensureStorageDir() {
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
      const raw = fs.readFileSync(filePath, 'utf8')
      return this.parseProfilesFile(raw)
    } catch {
      // If corrupted, don't crash the extension.
      return { version: 1, profiles: [] }
    }
  }

  private writeProfilesFile(data: ProfilesFileV1) {
    this.ensureStorageDir()
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

  private getGlobalStorageRoot(): string {
    // .../User/globalStorage/<publisher.name> -> .../User/globalStorage
    return path.dirname(this.getStorageDir())
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

  async findDuplicateProfile(authData: AuthData): Promise<ProfileSummary | undefined> {
    const file = await this.readProfilesFile()
    return file.profiles.find((p) => this.matchesAuth(p, authData))
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
    await this.context.secrets.store(this.secretKey(profileId), JSON.stringify(tokens))
    return true
  }

  private async maybeSyncToCodexAuthFile(profileId: string): Promise<void> {
    if (!profileId) return
    if (this.lastSyncedProfileId === profileId) return

    const authData = await this.loadAuthData(profileId)
    if (!authData) return

    syncCodexAuthFile(getDefaultCodexAuthPath(), authData)
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
    await this.context.secrets.store(this.secretKey(id), JSON.stringify(tokens))

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

    await this.context.secrets.delete(this.secretKey(profileId))
    await this.context.secrets.delete(this.legacySecretKey(profileId))

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
    const raw =
      (await this.context.secrets.get(this.secretKey(profileId))) ||
      (await this.context.secrets.get(this.legacySecretKey(profileId)))
    if (!raw) return null

    try {
      const tokens = JSON.parse(raw) as ProfileTokens
      return {
        idToken: tokens.idToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accountId: tokens.accountId,
        email: profile.email,
        planType: profile.planType,
        authJson: tokens.authJson,
      }
    } catch {
      return null
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
      bucket.get<string>(ACTIVE_PROFILE_KEY) ||
      bucket.get<string>(OLD_ACTIVE_PROFILE_KEY)

    let authData: AuthData | null = null
    if (profileId) {
      authData = await this.loadAuthData(profileId)
      if (!authData) {
        const p = await this.getProfile(profileId)
        void vscode.window.showErrorMessage(
          vscode.l10n.t(
            'Profile "{0}" is missing tokens. Re-import auth.json to replace it.',
            p?.name || profileId,
          ),
        )
        return false
      }
    }

    if (prev && profileId && prev !== profileId) {
      await this.setLastProfileId(prev)
    }
    await bucket.update(ACTIVE_PROFILE_KEY, profileId)
    await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)

    if (profileId && authData) {
      // We already validated tokens above; avoid a second secret read.
      syncCodexAuthFile(getDefaultCodexAuthPath(), authData)
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
}
