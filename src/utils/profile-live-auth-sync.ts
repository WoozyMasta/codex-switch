import type { AuthData, ProfileSummary } from '../types'

export async function maybeSyncProfileAuthToCodexAuthFile(
  deps: {
    lastSyncedProfileId: string | undefined
    loadAuthData: (profileId: string) => Promise<AuthData | null>
    syncProfileAuthToCodexAuthFile: (
      profileId: string,
      authData: AuthData,
    ) => void
  },
  profileId: string,
): Promise<void> {
  if (!profileId) {
    return
  }
  if (deps.lastSyncedProfileId === profileId) {
    return
  }

  const authData = await deps.loadAuthData(profileId)
  if (!authData) {
    return
  }

  deps.syncProfileAuthToCodexAuthFile(profileId, authData)
}

export async function captureLiveAuthForMatchingProfile(
  deps: {
    lastSyncedAuthHash: string | undefined
    readAuthFileHash: (authPath: string) => string | undefined
    loadLiveCodexAuthData: () => Promise<AuthData | null>
    findProfileByPreservationIdentity: (
      liveAuth: AuthData,
      preferredProfileId?: string,
    ) => Promise<ProfileSummary | undefined>
    maybeReplaceProfileAuthWithLive: (
      profile: ProfileSummary,
      liveAuth: AuthData,
    ) => Promise<boolean>
  },
  authPath: string,
): Promise<void> {
  const hash = deps.readAuthFileHash(authPath)
  if (!hash) {
    return
  }
  if (hash === deps.lastSyncedAuthHash) {
    return
  }

  const liveAuth = await deps.loadLiveCodexAuthData()
  if (!liveAuth) {
    return
  }

  const matchingProfile = await deps.findProfileByPreservationIdentity(liveAuth)
  if (!matchingProfile) {
    return
  }

  await deps.maybeReplaceProfileAuthWithLive(matchingProfile, liveAuth)
}
