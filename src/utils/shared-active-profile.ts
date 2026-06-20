import { firstDefinedString } from './strings'

/** Minimal interface for objects that identify an active profile. */
export interface SharedActiveProfileLike {
  /** The ID of the active profile. */
  profileId: string
}

/** Resolves the active profile, preferring per-home over legacy unless in non-default home. */
export function resolveSharedActiveProfile<T extends SharedActiveProfileLike>(
  perHome: T | null,
  legacy: T | null,
  isDefaultHome: boolean,
): T | null {
  if (perHome) {
    return perHome
  }

  if (isDefaultHome) {
    return legacy
  }

  return null
}

/** Resolves the active profile ID for the default home, checking remote or local sources based on mode. */
export function resolveDefaultHomeActiveProfileId(
  remoteDefault: string | null | undefined,
  remoteLegacy: string | null | undefined,
  localDefault: string | null | undefined,
  localActive: string | null | undefined,
  localOldActive: string | null | undefined,
  localLegacyOldActive: string | null | undefined,
  isRemoteFilesMode: boolean,
): string | undefined {
  if (isRemoteFilesMode) {
    return firstDefinedString(
      remoteDefault ?? undefined,
      remoteLegacy ?? undefined,
    )
  }

  return firstDefinedString(
    localDefault ?? undefined,
    localActive ?? undefined,
    localOldActive ?? undefined,
    localLegacyOldActive ?? undefined,
  )
}
