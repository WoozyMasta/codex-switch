export interface ProfileStateBucketLike {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void
}

export interface LastProfileStateKeys {
  current: string
  currentBase: string
  legacy: string
}

export async function readLastProfileIdFromState(
  bucket: ProfileStateBucketLike,
  legacyBucket: ProfileStateBucketLike,
  keys: LastProfileStateKeys,
  shouldMigrateLegacyState: boolean,
): Promise<string | undefined> {
  const current = bucket.get<string>(keys.current)
  if (current) {
    return current
  }

  if (shouldMigrateLegacyState) {
    const old =
      bucket.get<string>(keys.currentBase) ||
      bucket.get<string>(keys.legacy) ||
      legacyBucket.get<string>(keys.legacy)
    if (old) {
      await bucket.update(keys.current, old)
      await bucket.update(keys.legacy, undefined)
      await bucket.update(keys.currentBase, undefined)
      await legacyBucket.update(keys.legacy, undefined)
      return old
    }
  }

  return undefined
}

export async function writeLastProfileIdToState(
  bucket: ProfileStateBucketLike,
  keys: LastProfileStateKeys,
  profileId: string | undefined,
): Promise<void> {
  await bucket.update(keys.current, profileId)
  await bucket.update(keys.legacy, undefined)
}

export async function toggleLastProfileId(
  activeProfileId: string | undefined,
  lastProfileId: string | undefined,
  setActiveProfileId: (profileId: string) => Promise<boolean>,
  setLastProfileId: (profileId: string | undefined) => Promise<void>,
): Promise<string | undefined> {
  if (!lastProfileId) {
    return undefined
  }

  const ok = await setActiveProfileId(lastProfileId)
  if (ok && activeProfileId) {
    await setLastProfileId(activeProfileId)
  }
  return ok ? lastProfileId : undefined
}
