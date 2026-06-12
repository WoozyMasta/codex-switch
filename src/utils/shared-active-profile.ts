import { firstDefinedString } from './strings'

export interface SharedActiveProfileLike {
  profileId: string
}

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
