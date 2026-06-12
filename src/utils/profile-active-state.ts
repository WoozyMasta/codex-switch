import type { ProfileSummary } from '../types'
import { firstDefinedString } from './strings'

export interface ProfileStateBucketLike {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void
}

export interface ActiveProfileStateKeys {
  current: string
  currentBase: string
  legacy: string
}

export interface ActiveProfileStateDependencies {
  isRemoteFilesMode: boolean
  currentBucket: ProfileStateBucketLike
  legacyBucket: ProfileStateBucketLike
  keys: ActiveProfileStateKeys
  shouldMigrateLegacyProfileState: boolean
  readSharedActiveProfile: () => string | undefined
  writeSharedActiveProfile: (profileId: string) => void
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  inferActiveProfileIdFromAuthFile: () => Promise<string | undefined>
  inheritDefaultProfileIfCurrentHomeIsEmpty: () => Promise<string | undefined>
}

export interface ActiveProfileStateWriteDependencies {
  isRemoteFilesMode: boolean
  currentBucket: ProfileStateBucketLike
  keys: Pick<ActiveProfileStateKeys, 'current' | 'legacy'>
  writeSharedActiveProfile: (profileId: string) => void
  deleteSharedActiveProfile: () => void
}

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
