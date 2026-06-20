import type { ProfileTokens } from './profile-records'

/** Dependencies for reading/writing profile tokens with dual local/remote storage support. */
export interface StoredProfileTokensDependencies {
  /** Whether operating in remote files mode. */
  isRemoteFilesMode: boolean
  /** Reads tokens from remote storage (synchronous). */
  readRemoteProfileTokens: (profileId: string) => ProfileTokens | null
  /** Writes tokens to remote storage (synchronous). */
  writeRemoteProfileTokens: (profileId: string, tokens: ProfileTokens) => void
  /** Deletes tokens from remote storage (synchronous). */
  deleteRemoteProfileTokens: (profileId: string) => void
  /** Reads tokens from local secret storage (asynchronous). */
  readLocalStoredTokens: (profileId: string) => Promise<ProfileTokens | null>
  /** Writes tokens to local secret storage (asynchronous). */
  writeLocalStoredTokens: (
    profileId: string,
    tokens: ProfileTokens,
  ) => Promise<void>
  /** Deletes tokens from local secret storage (asynchronous). */
  deleteLocalStoredTokens: (profileId: string) => Promise<void>
}

/** Reads profile tokens from appropriate storage (remote or local) based on mode. */
export async function readStoredProfileTokens(
  deps: StoredProfileTokensDependencies,
  profileId: string,
): Promise<ProfileTokens | null> {
  if (deps.isRemoteFilesMode) {
    return deps.readRemoteProfileTokens(profileId)
  }

  return deps.readLocalStoredTokens(profileId)
}

/** Writes profile tokens to appropriate storage (remote or local) based on mode. */
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

/** Deletes profile tokens from appropriate storage (remote or local) based on mode. */
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
