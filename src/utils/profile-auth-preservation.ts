import type { AuthData, ProfileSummary } from '../types'
import { shouldReplaceStoredProfileAuthWithLive } from './auth-refresh-policy'
import { matchesPreservationIdentityForProfile } from './preservation-identity'

/** Base dependencies for loading stored authentication data. */
export interface ProfileAuthLookupDependencies {
  /** Loads stored auth data for a profile ID. */
  loadAuthData: (profileId: string) => Promise<AuthData | null>
}

/** Replaces profile auth with live auth if identity matches and refresh policy permits. */
export async function maybeReplaceProfileAuthWithLive(
  deps: ProfileAuthLookupDependencies & {
    replaceProfileAuth: (
      profileId: string,
      authData: AuthData,
    ) => Promise<boolean>
  },
  profile: ProfileSummary,
  liveAuth: AuthData,
): Promise<boolean> {
  const storedAuth = await deps.loadAuthData(profile.id)
  if (!matchesPreservationIdentityForProfile(profile, liveAuth, storedAuth)) {
    return false
  }

  if (!shouldReplaceStoredProfileAuthWithLive(storedAuth, liveAuth)) {
    return false
  }

  return deps.replaceProfileAuth(profile.id, liveAuth)
}

/** Finds a profile matching live auth identity, preferring the specified profile if given. */
export async function findProfileByPreservationIdentity(
  deps: ProfileAuthLookupDependencies & {
    listProfiles: () => Promise<ProfileSummary[]>
  },
  liveAuth: AuthData,
  preferredProfileId?: string,
): Promise<ProfileSummary | undefined> {
  const profiles = await deps.listProfiles()
  const orderedProfiles = preferredProfileId
    ? [
        ...profiles.filter((p) => p.id === preferredProfileId),
        ...profiles.filter((p) => p.id !== preferredProfileId),
      ]
    : profiles

  for (const profile of orderedProfiles) {
    const storedAuth = await deps.loadAuthData(profile.id)
    if (matchesPreservationIdentityForProfile(profile, liveAuth, storedAuth)) {
      return profile
    }
  }

  return undefined
}
