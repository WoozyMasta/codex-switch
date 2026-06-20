import type { AuthData, ProfileSummary } from '../types'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from './auth-identity'
import { asOptionalString } from './strings'

/** Selects the first non-empty trimmed string from a list of values. */
function pickNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const v = asOptionalString(value)
    if (v) {
      return v
    }
  }
  return undefined
}

/** Builds identity snapshot from profile and stored auth, preferring stored values over profile. */
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

/** Checks if live auth matches the preservation identity of a profile with optional stored auth. */
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
