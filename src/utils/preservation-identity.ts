import type { AuthData, ProfileSummary } from '../types'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from './auth-identity'

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function pickNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const v = asOptionalString(value)
    if (v) {
      return v
    }
  }
  return undefined
}

export function buildStoredPreservationIdentity(
  profile: ProfileSummary,
  storedAuth: AuthData | null,
) {
  return buildIdentitySnapshot({
    defaultOrganizationId: pickNonEmptyString(
      storedAuth?.defaultOrganizationId,
      profile.defaultOrganizationId,
    ),
    chatgptUserId: pickNonEmptyString(
      storedAuth?.chatgptUserId,
      profile.chatgptUserId,
    ),
    userId: pickNonEmptyString(storedAuth?.userId, profile.userId),
    subject: pickNonEmptyString(storedAuth?.subject, profile.subject),
  })
}

export function matchesPreservationIdentityForProfile(
  profile: ProfileSummary,
  liveAuth: AuthData,
  storedAuth: AuthData | null,
): boolean {
  return (
    compareIdentitySnapshots(
      buildStoredPreservationIdentity(profile, storedAuth),
      buildIdentitySnapshot(liveAuth),
    ) === 'exact'
  )
}
