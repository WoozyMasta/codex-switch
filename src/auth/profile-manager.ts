import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { AuthData, ProfileSummary } from '../types'

type ProfileTokens = Pick<
  AuthData,
  'idToken' | 'accessToken' | 'refreshToken' | 'accountId'
>

interface ProfilesFileV1 {
  version: 1
  profiles: ProfileSummary[]
}

const PROFILES_FILENAME = 'profiles.json'
const ACTIVE_PROFILE_KEY = 'codexSwitch.activeProfileId'
const LAST_PROFILE_KEY = 'codexSwitch.lastProfileId'

// Backward compatibility keys (pre-rename).
const OLD_ACTIVE_PROFILE_KEY = 'codexUsage.activeProfileId'
const OLD_LAST_PROFILE_KEY = 'codexUsage.lastProfileId'
const OLD_SECRET_PREFIX = 'codexUsage.profile.'
const NEW_SECRET_PREFIX = 'codexSwitch.profile.'

export class ProfileManager {
  constructor(private context: vscode.ExtensionContext) {}

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

  private async readProfilesFile(): Promise<ProfilesFileV1> {
    this.ensureStorageDir()
    const filePath = this.getProfilesPath()
    if (!fs.existsSync(filePath)) {
      return { version: 1, profiles: [] }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ProfilesFileV1>
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
        return { version: 1, profiles: [] }
      }
      return { version: 1, profiles: parsed.profiles }
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

  async listProfiles(): Promise<ProfileSummary[]> {
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
    }
    await this.context.secrets.store(this.secretKey(profileId), JSON.stringify(tokens))
    return true
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

  async setActiveProfileId(profileId: string | undefined): Promise<void> {
    const bucket = this.getStateBucket()
    const prev =
      bucket.get<string>(ACTIVE_PROFILE_KEY) ||
      bucket.get<string>(OLD_ACTIVE_PROFILE_KEY)
    if (prev && profileId && prev !== profileId) {
      await this.setLastProfileId(prev)
    }
    await bucket.update(ACTIVE_PROFILE_KEY, profileId)
    await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
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
    await this.setActiveProfileId(last)
    if (active) {
      // Swap so a second click toggles back.
      await this.setLastProfileId(active)
    }
    return last
  }
}
