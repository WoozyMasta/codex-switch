import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { AuthData, ProfileSummary, StorageMode } from '../types'
import {
  extractAuthDataFromAuthJson,
  getDefaultCodexAuthPath,
  loadAuthDataFromFile,
} from './auth-manager'
import { buildCodexAuthJson, syncCodexAuthFile } from './codex-auth-sync'
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

interface ParsedImportEntry {
  sourceProfileId?: string
  name: string
  authData: AuthData
}

interface CanonicalTokenBundle {
  idToken: string
  accessToken: string
  refreshToken: string
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

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const v = value.trim()
  return v ? v : undefined
}

export class ProfileManager {
  constructor(private context: vscode.ExtensionContext) {}

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

  private normalizeEmail(email: string | undefined): string {
    return String(email || '')
      .trim()
      .toLowerCase()
  }

  private asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  private pickNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
      const v = this.asNonEmptyString(value)
      if (v) {
        return v
      }
    }
    return undefined
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
    if (!p || !a) {
      return undefined
    }
    return p === a
  }

  private matchesAuth(profile: ProfileSummary, authData: AuthData): boolean {
    const hasProfileOrganizationId = Boolean(
      this.normalizeIdentity(profile.defaultOrganizationId),
    )
    const hasAuthOrganizationId = Boolean(
      this.normalizeIdentity(authData.defaultOrganizationId),
    )
    const organizationIdMatch = this.compareIdentityField(
      profile.defaultOrganizationId,
      authData.defaultOrganizationId,
    )

    // Team/Business tenants can share account_id across different users.
    // Match by user identity fields first.
    // If identity matches and both sides know the selected workspace/org, require it too.
    const identityMatches = [
      this.compareIdentityField(profile.chatgptUserId, authData.chatgptUserId),
      this.compareIdentityField(profile.userId, authData.userId),
      this.compareIdentityField(profile.subject, authData.subject),
    ].filter((v): v is boolean => v !== undefined)

    if (identityMatches.length > 0) {
      if (identityMatches.some((v) => !v)) {
        return false
      }
      if (hasProfileOrganizationId || hasAuthOrganizationId) {
        // If workspace is known only on one side, avoid collapsing profiles.
        if (organizationIdMatch === undefined) {
          return false
        }
        return organizationIdMatch
      }
      return true
    }

    const pe = this.normalizeEmail(profile.email)
    const ae = this.normalizeEmail(authData.email)
    const hasComparableEmail =
      Boolean(pe) && Boolean(ae) && pe !== 'unknown' && ae !== 'unknown'
    const hasComparableAccountId =
      Boolean(authData.accountId) && Boolean(profile.accountId)
    const accountIdMatch = hasComparableAccountId
      ? authData.accountId === profile.accountId
      : false
    const hasComparableOrganizationId = organizationIdMatch !== undefined

    if (
      (hasProfileOrganizationId || hasAuthOrganizationId) &&
      !hasComparableOrganizationId
    ) {
      // Workspace is known only on one side: treat as distinct to avoid false matches.
      return false
    }

    if (
      hasComparableEmail &&
      hasComparableAccountId &&
      hasComparableOrganizationId
    ) {
      return pe === ae && accountIdMatch && organizationIdMatch === true
    }

    if (hasComparableEmail && hasComparableOrganizationId) {
      return pe === ae && organizationIdMatch === true
    }

    if (hasComparableEmail && hasComparableAccountId) {
      return pe === ae && accountIdMatch
    }

    if (hasComparableAccountId && hasComparableOrganizationId) {
      return accountIdMatch && organizationIdMatch === true
    }

    if (hasComparableEmail) {
      return pe === ae
    }

    return false
  }

  private matchesPreservationIdentity(
    storedIdentity: {
      chatgptUserId?: string
      userId?: string
      subject?: string
    },
    liveAuth: AuthData,
  ): boolean {
    const fields: Array<'chatgptUserId' | 'userId' | 'subject'> = [
      'chatgptUserId',
      'userId',
      'subject',
    ]

    let comparedFieldCount = 0
    let matchedFieldCount = 0
    for (const field of fields) {
      const storedValue = this.normalizeIdentity(storedIdentity[field])
      const liveValue = this.normalizeIdentity(liveAuth[field])
      if (!storedValue || !liveValue) {
        continue
      }

      comparedFieldCount += 1
      if (storedValue !== liveValue) {
        return false
      }
      matchedFieldCount += 1
    }

    return comparedFieldCount > 0 && matchedFieldCount > 0
  }

  private getStoredPreservationIdentity(
    profile: ProfileSummary,
    storedAuth: AuthData | null,
  ): {
    chatgptUserId?: string
    userId?: string
    subject?: string
  } {
    return {
      chatgptUserId: this.pickNonEmptyString(
        storedAuth?.chatgptUserId,
        profile.chatgptUserId,
      ),
      userId: this.pickNonEmptyString(storedAuth?.userId, profile.userId),
      subject: this.pickNonEmptyString(storedAuth?.subject, profile.subject),
    }
  }

  private matchesPreservationIdentityForProfile(
    profile: ProfileSummary,
    liveAuth: AuthData,
    storedAuth: AuthData | null,
  ): boolean {
    const storedIdentity = this.getStoredPreservationIdentity(
      profile,
      storedAuth,
    )
    return this.matchesPreservationIdentity(storedIdentity, liveAuth)
  }

  private async loadLiveCodexAuthData(): Promise<AuthData | null> {
    return loadAuthDataFromFile(getDefaultCodexAuthPath())
  }

  private parseLastRefreshValue(value: unknown): number | undefined {
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        return value
      }
      return undefined
    }

    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }

    const parsedNumber = Number(trimmed)
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber
    }

    const parsedDate = Date.parse(trimmed)
    if (Number.isFinite(parsedDate)) {
      return parsedDate
    }

    return undefined
  }

  private getAuthLastRefresh(authData: AuthData | null): number | undefined {
    if (
      !authData ||
      !authData.authJson ||
      typeof authData.authJson !== 'object'
    ) {
      return undefined
    }
    return this.parseLastRefreshValue(
      (authData.authJson as Record<string, unknown>).last_refresh,
    )
  }

  private getCanonicalTokenBundle(
    authData: AuthData,
  ): CanonicalTokenBundle | undefined {
    const authJson = asObject(authData.authJson)
    if (!authJson) {
      return undefined
    }

    const tokens = asObject(authJson.tokens)
    if (!tokens) {
      return undefined
    }

    const idToken = this.asNonEmptyString(tokens.id_token)
    const accessToken = this.asNonEmptyString(tokens.access_token)
    const refreshToken = this.asNonEmptyString(tokens.refresh_token)

    if (!idToken || !accessToken || !refreshToken) {
      return undefined
    }

    return {
      idToken,
      accessToken,
      refreshToken,
    }
  }

  private shouldReplaceStoredProfileAuthWithLive(
    storedAuth: AuthData | null,
    liveAuth: AuthData,
  ): boolean {
    const liveTokens = this.getCanonicalTokenBundle(liveAuth)
    if (!liveTokens) {
      return false
    }

    if (!storedAuth) {
      return true
    }

    const storedTokens = this.getCanonicalTokenBundle(storedAuth)
    if (!storedTokens) {
      return true
    }

    const storedRefresh = this.getAuthLastRefresh(storedAuth)
    const liveRefresh = this.getAuthLastRefresh(liveAuth)

    if (
      storedRefresh !== undefined &&
      liveRefresh !== undefined &&
      liveRefresh < storedRefresh
    ) {
      return false
    }

    if (storedRefresh !== undefined && liveRefresh === undefined) {
      return false
    }

    if (
      storedTokens.idToken !== liveTokens.idToken ||
      storedTokens.accessToken !== liveTokens.accessToken ||
      storedTokens.refreshToken !== liveTokens.refreshToken
    ) {
      return true
    }

    if (storedRefresh === undefined && liveRefresh !== undefined) {
      return true
    }

    return false
  }

  private async maybeReplaceProfileAuthWithLive(
    profile: ProfileSummary,
    liveAuth: AuthData,
  ): Promise<boolean> {
    const storedAuth = await this.loadAuthData(profile.id)
    if (
      !this.matchesPreservationIdentityForProfile(profile, liveAuth, storedAuth)
    ) {
      return false
    }

    if (!this.shouldReplaceStoredProfileAuthWithLive(storedAuth, liveAuth)) {
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
        this.matchesPreservationIdentityForProfile(
          profile,
          liveAuth,
          storedAuth,
        )
      ) {
        return profile
      }
    }
    return undefined
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  private readAuthFileHash(authPath: string): string | undefined {
    try {
      if (!fs.existsSync(authPath)) {
        return undefined
      }
      const content = fs.readFileSync(authPath, 'utf8')
      return this.computeHash(content)
    } catch {
      return undefined
    }
  }

  private syncProfileAuthToCodexAuthFile(
    profileId: string,
    authData: AuthData,
  ): void {
    const content = buildCodexAuthJson(authData)
    syncCodexAuthFile(getDefaultCodexAuthPath(), authData)
    this.lastSyncedProfileId = profileId
    this.lastSyncedAuthHash = this.computeHash(content)
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
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.profiles)
    ) {
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
        if (parsed == null) {
          return { version: 1, profiles: [] }
        }
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
    if (!this.isRemoteFilesMode()) {
      return null
    }
    return readJsonFile<SharedActiveProfile>(getSharedActiveProfilePath())
  }

  private writeSharedActiveProfile(profileId: string): void {
    if (!this.isRemoteFilesMode()) {
      return
    }
    writeJsonFile(getSharedActiveProfilePath(), {
      profileId,
      updatedAt: new Date().toISOString(),
    } satisfies SharedActiveProfile)
  }

  private deleteSharedActiveProfile(): void {
    if (!this.isRemoteFilesMode()) {
      return
    }
    deleteFileIfExists(getSharedActiveProfilePath())
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

    const raw =
      (await this.context.secrets.get(this.secretKey(profileId))) ||
      (await this.context.secrets.get(this.legacySecretKey(profileId)))
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

    await this.context.secrets.store(
      this.secretKey(profileId),
      JSON.stringify(tokens),
    )
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
        const legacy = this.parseProfilesFile(raw)
        if (!legacy.profiles || legacy.profiles.length === 0) {
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

  private parseImportEntry(value: unknown): ParsedImportEntry | null {
    const entry = asObject(value)
    if (!entry) {
      return null
    }

    const profile = asObject(entry.profile)
    const tokens = asObject(entry.tokens)
    if (!profile || !tokens) {
      return null
    }

    const idToken = asOptionalString(tokens.idToken)
    const accessToken = asOptionalString(tokens.accessToken)
    const refreshToken = asOptionalString(tokens.refreshToken)
    if (!idToken || !accessToken || !refreshToken) {
      return null
    }

    const email = asOptionalString(profile.email) || 'Unknown'
    const planType = asOptionalString(profile.planType) || 'Unknown'
    const name =
      asOptionalString(profile.name) ||
      (email !== 'Unknown' ? email.split('@')[0] : undefined) ||
      'profile'

    const authJson = asObject(tokens.authJson) || undefined
    const accountId =
      asOptionalString(tokens.accountId) || asOptionalString(profile.accountId)

    return {
      sourceProfileId: asOptionalString(profile.id),
      name,
      authData: {
        idToken,
        accessToken,
        refreshToken,
        accountId,
        defaultOrganizationId: asOptionalString(profile.defaultOrganizationId),
        defaultOrganizationTitle: asOptionalString(
          profile.defaultOrganizationTitle,
        ),
        chatgptUserId: asOptionalString(profile.chatgptUserId),
        userId: asOptionalString(profile.userId),
        subject: asOptionalString(profile.subject),
        email,
        planType,
        authJson,
      },
    }
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
      const parsed = this.parseImportEntry(rawEntry)
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
    const authData = await loadAuthDataFromFile(getDefaultCodexAuthPath())
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

  async replaceProfileAuth(
    profileId: string,
    authData: AuthData,
  ): Promise<boolean> {
    const file = await this.readProfilesFile()
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
    const now = new Date().toISOString()
    const id = randomUUID()

    const profile: ProfileSummary = {
      id,
      name,
      email: authData.email,
      planType: authData.planType,
      accountId: authData.accountId,
      defaultOrganizationId: authData.defaultOrganizationId,
      defaultOrganizationTitle: authData.defaultOrganizationTitle,
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
    const file = await this.readProfilesFile()
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
    if (v) {
      const existing = await this.getProfile(v)
      if (existing) {
        return v
      }

      const inferred = await this.inferActiveProfileIdFromAuthFile()
      if (inferred && inferred !== v) {
        await bucket.update(ACTIVE_PROFILE_KEY, inferred)
        await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        return inferred
      }

      await bucket.update(ACTIVE_PROFILE_KEY, undefined)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return undefined
    }

    // Migrate old key lazily.
    const legacyBucket = this.getLegacyStateBucket()
    const old =
      bucket.get<string>(OLD_ACTIVE_PROFILE_KEY) ||
      legacyBucket.get<string>(OLD_ACTIVE_PROFILE_KEY)
    if (old) {
      const existing = await this.getProfile(old)
      if (existing) {
        await bucket.update(ACTIVE_PROFILE_KEY, old)
        await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        await legacyBucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
        return old
      }

      const inferred = await this.inferActiveProfileIdFromAuthFile()
      await bucket.update(ACTIVE_PROFILE_KEY, inferred)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      await legacyBucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return inferred
    }

    const inferred = await this.inferActiveProfileIdFromAuthFile()
    if (inferred) {
      await bucket.update(ACTIVE_PROFILE_KEY, inferred)
      await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
      return inferred
    }

    return undefined
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
    await bucket.update(ACTIVE_PROFILE_KEY, profileId)
    await bucket.update(OLD_ACTIVE_PROFILE_KEY, undefined)
  }

  async prepareForNewLoginChat(): Promise<PrepareForNewLoginChatResult> {
    const authPath = getDefaultCodexAuthPath()

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
          this.matchesPreservationIdentityForProfile(
            selectedProfile,
            liveAuth,
            authData,
          )
        ) {
          if (this.shouldReplaceStoredProfileAuthWithLive(authData, liveAuth)) {
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

  async getLastProfileId(): Promise<string | undefined> {
    const bucket = this.getStateBucket()
    const v = bucket.get<string>(LAST_PROFILE_KEY)
    if (v) {
      return v
    }

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
        this.matchesPreservationIdentityForProfile(
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
      }
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

  createWatchers(onChanged: () => void): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = []
    const fire = () => {
      try {
        onChanged()
      } catch {
        // ignore refresh errors from file watchers
      }
    }

    const authPath = getDefaultCodexAuthPath()
    let authDebounceTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleAuthCapture = () => {
      if (authDebounceTimer) {
        clearTimeout(authDebounceTimer)
      }
      authDebounceTimer = setTimeout(() => {
        void (async () => {
          try {
            await this.captureLiveAuthForMatchingProfile(authPath)
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

    const authDir = path.dirname(authPath)
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
          vscode.Uri.file(getSharedStoreRoot()),
          SHARED_ACTIVE_PROFILE_FILENAME,
        ),
      )
      activeWatcher.onDidCreate(fire)
      activeWatcher.onDidChange(fire)
      activeWatcher.onDidDelete(fire)
      disposables.push(activeWatcher)

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
