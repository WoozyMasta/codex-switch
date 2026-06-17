import { AuthData, ProfileSummary } from '../types'
import { parseImportEntry } from '../utils/import-entry'
import { asOptionalString } from '../utils/strings'
import type { ProfileTokens } from '../utils/profile-records'

export interface ExportedProfileEntryV1 {
  profile: ProfileSummary
  tokens: ProfileTokens
}

export interface ExportedSettingsV1 {
  format: 'codex-switch-profile-export'
  version: 1
  exportedAt: string
  activeProfileId?: string
  lastProfileId?: string
  profiles: ExportedProfileEntryV1[]
}

export interface ImportProfilesResult {
  created: number
  updated: number
  skipped: number
}

interface ProfileTransferDeps {
  listProfiles: () => Promise<ProfileSummary[]>
  getActiveProfileId: () => Promise<string | undefined>
  getLastProfileId: () => Promise<string | undefined>
  readStoredTokens: (profileId: string) => Promise<ProfileTokens | null>
  findDuplicateProfile: (
    authData: AuthData,
  ) => Promise<ProfileSummary | undefined>
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  createProfile: (name: string, authData: AuthData) => Promise<ProfileSummary>
  setActiveProfileId: (profileId: string | undefined) => Promise<boolean>
  setLastProfileId: (profileId: string | undefined) => Promise<void>
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export class ProfileTransferService {
  constructor(private readonly deps: ProfileTransferDeps) {}

  async exportProfilesForTransfer(): Promise<{
    data: ExportedSettingsV1
    skipped: number
  }> {
    const profiles = await this.deps.listProfiles()
    const activeProfileId = await this.deps.getActiveProfileId()
    const lastProfileId = await this.deps.getLastProfileId()

    const exportedProfiles: ExportedProfileEntryV1[] = []
    let skipped = 0

    for (const profile of profiles) {
      const tokens = await this.deps.readStoredTokens(profile.id)
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

      const duplicate = await this.deps.findDuplicateProfile(parsed.authData)
      if (duplicate) {
        await this.deps.replaceProfileAuth(duplicate.id, parsed.authData)
        if (parsed.sourceProfileId) {
          sourceToTargetId.set(parsed.sourceProfileId, duplicate.id)
        }
        updated += 1
        continue
      }

      const createdProfile = await this.deps.createProfile(
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
        await this.deps.setActiveProfileId(targetId)
      }
    }

    const importedLastProfileId = asOptionalString(payload.lastProfileId)
    if (importedLastProfileId) {
      const targetId = sourceToTargetId.get(importedLastProfileId)
      if (targetId) {
        await this.deps.setLastProfileId(targetId)
      }
    }

    return { created, updated, skipped }
  }
}
