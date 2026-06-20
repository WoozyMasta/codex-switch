import { AuthData, ProfileSummary } from '../types'
import { parseImportEntry } from '../utils/import-entry'
import { asOptionalString } from '../utils/strings'
import type { ProfileTokens } from '../utils/profile-records'

/**
 * A single profile entry in an export file.
 */
export interface ExportedProfileEntryV1 {
  /** The profile summary. */
  profile: ProfileSummary
  /** The stored authentication tokens for the profile. */
  tokens: ProfileTokens
}

/**
 * The complete export data format for transferring profiles between machines.
 */
export interface ExportedSettingsV1 {
  /** Magic format string for validation. */
  format: 'codex-switch-profile-export'
  /** Version number for future compatibility. */
  version: 1
  /** Timestamp when the export was created. */
  exportedAt: string
  /** The ID of the active profile at export time, if any. */
  activeProfileId?: string
  /** The ID of the last active profile at export time, if any. */
  lastProfileId?: string
  /** Array of exported profile entries. */
  profiles: ExportedProfileEntryV1[]
}

/**
 * Result of importing profiles from a transfer export.
 */
export interface ImportProfilesResult {
  /** Number of profiles created during import. */
  created: number
  /** Number of profiles updated during import (duplicate found). */
  updated: number
  /** Number of profiles skipped due to parsing errors. */
  skipped: number
}

/**
 * Dependencies for ProfileTransferService.
 */
interface ProfileTransferDeps {
  /** Function to list all profiles. */
  listProfiles: () => Promise<ProfileSummary[]>
  /** Function to get the currently active profile ID. */
  getActiveProfileId: () => Promise<string | undefined>
  /** Function to get the last active profile ID. */
  getLastProfileId: () => Promise<string | undefined>
  /** Function to read stored tokens for a profile. */
  readStoredTokens: (profileId: string) => Promise<ProfileTokens | null>
  /** Function to find a duplicate profile by auth data. */
  findDuplicateProfile: (
    authData: AuthData,
  ) => Promise<ProfileSummary | undefined>
  /** Function to replace profile auth data. */
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  /** Function to create a new profile. */
  createProfile: (name: string, authData: AuthData) => Promise<ProfileSummary>
  /** Function to set the active profile ID. */
  setActiveProfileId: (profileId: string | undefined) => Promise<boolean>
  /** Function to set the last active profile ID. */
  setLastProfileId: (profileId: string | undefined) => Promise<void>
}

/**
 * Safely casts an unknown value to an object, or null if not an object.
 * @param value - The value to cast.
 * @returns The object, or null if the value is not a plain object.
 * @internal
 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/**
 * Handles exporting and importing profiles for transfer between machines or instances.
 * Manages both the export format and the import logic with deduplication.
 */
export class ProfileTransferService {
  /**
   * Creates a new ProfileTransferService instance.
   * @param deps - Dependencies for transfer operations.
   */
  constructor(private readonly deps: ProfileTransferDeps) {}

  /**
   * Exports all profiles and their state for transfer to another machine.
   * Skips profiles without stored tokens.
   * @returns A promise that resolves to the export data and count of skipped profiles.
   */
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

  /**
   * Imports profiles from a transfer export.
   * Creates new profiles or updates existing duplicates based on auth data matching.
   * Restores the active and last profile state from the export.
   * @param value - The export data to import (typically from exportProfilesForTransfer).
   * @returns A promise that resolves to the import result.
   * @throws Error if the export format is invalid or unsupported.
   */
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
