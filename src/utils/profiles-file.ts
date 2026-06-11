import type { ProfileSummary } from '../types'
import { parseProfileSummary } from './profile-summary'

export interface ProfilesFileV1 {
  version: 1
  profiles: ProfileSummary[]
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function parseProfilesFile(raw: string): ProfilesFileV1 | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const profiles = (values: unknown[]): ProfileSummary[] =>
    values
      .map((value) => parseProfileSummary(value))
      .filter((value): value is ProfileSummary => value !== null)

  // Legacy format: plain array of profiles.
  if (Array.isArray(parsed)) {
    const parsedProfiles = profiles(parsed)
    return parsed.length > 0 && parsedProfiles.length === 0
      ? null
      : { version: 1, profiles: parsedProfiles }
  }

  const payload = asObject(parsed)
  if (!payload) {
    return null
  }

  // Current format: { version: 1, profiles: [...] }
  if (payload.version === 1 && Array.isArray(payload.profiles)) {
    const parsedProfiles = profiles(payload.profiles)
    return payload.profiles.length > 0 && parsedProfiles.length === 0
      ? null
      : { version: 1, profiles: parsedProfiles }
  }

  if (payload.version !== undefined) {
    return null
  }

  // Legacy format: { profiles: [...] } without a version.
  if (Array.isArray(payload.profiles)) {
    const parsedProfiles = profiles(payload.profiles)
    return payload.profiles.length > 0 && parsedProfiles.length === 0
      ? null
      : { version: 1, profiles: parsedProfiles }
  }

  return null
}
