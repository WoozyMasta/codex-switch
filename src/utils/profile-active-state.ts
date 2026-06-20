import type { ProfileSummary } from '../types'
import { firstDefinedString } from './strings'

/** Generic key-value store interface for profile state persistence. */
export interface ProfileStateBucketLike {
  /** Retrieves a value by key, returning undefined if not found. */
  get<T>(key: string): T | undefined
  /** Updates or deletes a key-value pair, supporting synchronous or asynchronous operations. */
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void
}

/** Storage keys for tracking active profile state across different versions. */
export interface ActiveProfileStateKeys {
  /** Key for the current home-scoped active profile. */
  current: string
  /** Key for the base home-scoped active profile (pre-migration). */
  currentBase: string
  /** Key for the legacy global active profile. */
  legacy: string
}

/** Dependencies for resolving the active profile with multi-source fallback logic. */
export interface ActiveProfileStateDependencies {
  /** Whether operating in remote files mode. */
  isRemoteFilesMode: boolean
  /** Storage bucket for current home-scoped state. */
  currentBucket: ProfileStateBucketLike
  /** Storage bucket for legacy global state. */
  legacyBucket: ProfileStateBucketLike
  /** State storage keys. */
  keys: ActiveProfileStateKeys
  /** Whether to attempt migration from legacy state format. */
  shouldMigrateLegacyProfileState: boolean
  /** Reads explicitly set shared active profile ID. */
  readSharedActiveProfile: () => string | undefined
  /** Writes shared active profile ID. */
  writeSharedActiveProfile: (profileId: string) => void
  /** Fetches a profile by ID. */
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  /** Infers active profile ID from authentication file. */
  inferActiveProfileIdFromAuthFile: () => Promise<string | undefined>
  /** Falls back to default profile for current home if empty. */
  inheritDefaultProfileIfCurrentHomeIsEmpty: () => Promise<string | undefined>
}

/** Dependencies for updating the active profile state. */
export interface ActiveProfileStateWriteDependencies {
  /** Whether operating in remote files mode. */
  isRemoteFilesMode: boolean
  /** Storage bucket for current home-scoped state. */
  currentBucket: ProfileStateBucketLike
  /** State storage keys (current and legacy only). */
  keys: Pick<ActiveProfileStateKeys, 'current' | 'legacy'>
  /** Writes shared active profile ID. */
  writeSharedActiveProfile: (profileId: string) => void
  /** Clears shared active profile state. */
  deleteSharedActiveProfile: () => void
}

/** Determines the active profile ID using a cascading resolution strategy with migration support. */
export async function resolveActiveProfileId(
  deps: ActiveProfileStateDependencies,
): Promise<string | undefined> {
  if (deps.isRemoteFilesMode) {
    const explicit = deps.readSharedActiveProfile()
    const inferred = await deps.inferActiveProfileIdFromAuthFile()

    if (inferred) {
      if (explicit !== inferred) {
        deps.writeSharedActiveProfile(inferred)
      }
      return inferred
    }

    return firstDefinedString(
      explicit,
      await deps.inheritDefaultProfileIfCurrentHomeIsEmpty(),
    )
  }

  const active = deps.currentBucket.get<string>(deps.keys.current)
  if (active) {
    const existing = await deps.getProfile(active)
    if (existing) {
      return active
    }

    const inferred = await deps.inferActiveProfileIdFromAuthFile()
    if (inferred && inferred !== active) {
      await deps.currentBucket.update(deps.keys.current, inferred)
      await deps.currentBucket.update(deps.keys.legacy, undefined)
      return inferred
    }

    await deps.currentBucket.update(deps.keys.current, undefined)
    await deps.currentBucket.update(deps.keys.legacy, undefined)
    return undefined
  }

  if (deps.shouldMigrateLegacyProfileState) {
    const old =
      deps.currentBucket.get<string>(deps.keys.currentBase) ||
      deps.currentBucket.get<string>(deps.keys.legacy) ||
      deps.legacyBucket.get<string>(deps.keys.legacy)
    if (old) {
      const existing = await deps.getProfile(old)
      if (existing) {
        await deps.currentBucket.update(deps.keys.current, old)
        await deps.currentBucket.update(deps.keys.legacy, undefined)
        await deps.currentBucket.update(deps.keys.currentBase, undefined)
        await deps.legacyBucket.update(deps.keys.legacy, undefined)
        return old
      }

      const inferred = await deps.inferActiveProfileIdFromAuthFile()
      await deps.currentBucket.update(deps.keys.current, inferred)
      await deps.currentBucket.update(deps.keys.legacy, undefined)
      await deps.currentBucket.update(deps.keys.currentBase, undefined)
      await deps.legacyBucket.update(deps.keys.legacy, undefined)
      return inferred
    }
  }

  const inferred = await deps.inferActiveProfileIdFromAuthFile()
  if (inferred) {
    await deps.currentBucket.update(deps.keys.current, inferred)
    await deps.currentBucket.update(deps.keys.legacy, undefined)
    return inferred
  }

  return deps.inheritDefaultProfileIfCurrentHomeIsEmpty()
}

/** Updates active profile state, handling both remote and local storage modes appropriately. */
export async function setActiveProfileIdInState(
  deps: ActiveProfileStateWriteDependencies,
  profileId: string | undefined,
): Promise<void> {
  if (deps.isRemoteFilesMode) {
    if (profileId) {
      deps.writeSharedActiveProfile(profileId)
    } else {
      deps.deleteSharedActiveProfile()
    }
    return
  }

  await deps.currentBucket.update(deps.keys.current, profileId)
  await deps.currentBucket.update(deps.keys.legacy, undefined)
}
