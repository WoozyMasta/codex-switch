import type { ProfileTokens } from './profile-records'

export interface StoredProfileTokensDependencies {
  isRemoteFilesMode: boolean
  readRemoteProfileTokens: (profileId: string) => ProfileTokens | null
  writeRemoteProfileTokens: (profileId: string, tokens: ProfileTokens) => void
  deleteRemoteProfileTokens: (profileId: string) => void
  readLocalStoredTokens: (profileId: string) => Promise<ProfileTokens | null>
  writeLocalStoredTokens: (
    profileId: string,
    tokens: ProfileTokens,
  ) => Promise<void>
  deleteLocalStoredTokens: (profileId: string) => Promise<void>
}

export async function readStoredProfileTokens(
  deps: StoredProfileTokensDependencies,
  profileId: string,
): Promise<ProfileTokens | null> {
  if (deps.isRemoteFilesMode) {
    return deps.readRemoteProfileTokens(profileId)
  }

  return deps.readLocalStoredTokens(profileId)
}

export async function writeStoredProfileTokens(
  deps: StoredProfileTokensDependencies,
  profileId: string,
  tokens: ProfileTokens,
): Promise<void> {
  if (deps.isRemoteFilesMode) {
    deps.writeRemoteProfileTokens(profileId, tokens)
    return
  }

  await deps.writeLocalStoredTokens(profileId, tokens)
}

export async function deleteStoredProfileTokens(
  deps: StoredProfileTokensDependencies,
  profileId: string,
): Promise<void> {
  if (deps.isRemoteFilesMode) {
    deps.deleteRemoteProfileTokens(profileId)
    return
  }

  await deps.deleteLocalStoredTokens(profileId)
}
