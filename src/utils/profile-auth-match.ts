import type { AuthData, ProfileSummary } from '../types'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from './auth-identity'

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
