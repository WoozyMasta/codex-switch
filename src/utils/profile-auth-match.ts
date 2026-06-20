import type { AuthData, ProfileSummary } from '../types'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from './auth-identity'

/** Finds a profile matching the authentication data through identity comparison, or undefined if no match. */
export function findMatchingProfileIdForAuth(
  profiles: ProfileSummary[],
  authData: AuthData,
): string | undefined {
  const authSnapshot = buildIdentitySnapshot(authData)
  for (const profile of profiles) {
    if (
      compareIdentitySnapshots(buildIdentitySnapshot(profile), authSnapshot) ===
      'exact'
    ) {
      return profile.id
    }
  }
  return undefined
}
