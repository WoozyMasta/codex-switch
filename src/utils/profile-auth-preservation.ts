import type { AuthData, ProfileSummary } from '../types'
import { shouldReplaceStoredProfileAuthWithLive } from './auth-refresh-policy'
import { matchesPreservationIdentityForProfile } from './preservation-identity'

export interface ProfileAuthLookupDependencies {
  loadAuthData: (profileId: string) => Promise<AuthData | null>
}

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
