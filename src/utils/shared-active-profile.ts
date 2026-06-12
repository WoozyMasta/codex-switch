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
