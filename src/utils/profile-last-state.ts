/** Generic key-value store interface for profile state persistence. */
export interface ProfileStateBucketLike {
  /** Retrieves a value by key, returning undefined if not found. */
  get<T>(key: string): T | undefined
  /** Updates or deletes a key-value pair, supporting synchronous or asynchronous operations. */
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void
}

/** Storage keys for tracking last used profile state across different versions. */
export interface LastProfileStateKeys {
  /** Key for the current home-scoped last profile. */
  current: string
  /** Key for the base home-scoped last profile (pre-migration). */
  currentBase: string
  /** Key for the legacy global last profile. */
  legacy: string
}

/** Reads the last profile ID from state with migration support for legacy storage format. */
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

/** Writes the last profile ID to state, clearing legacy state keys. */
export async function writeLastProfileIdToState(
  bucket: ProfileStateBucketLike,
  keys: LastProfileStateKeys,
  profileId: string | undefined,
): Promise<void> {
  await bucket.update(keys.current, profileId)
  await bucket.update(keys.legacy, undefined)
}

/** Swaps active and last profile IDs if last profile is set and successfully activated. */
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
