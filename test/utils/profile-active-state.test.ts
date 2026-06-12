import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ActiveProfileStateDependencies,
  ActiveProfileStateWriteDependencies,
  ProfileStateBucketLike,
} from '../../src/utils/profile-active-state'
import {
  resolveActiveProfileId,
  setActiveProfileIdInState,
} from '../../src/utils/profile-active-state'
import type { ProfileSummary } from '../../src/types'

class MemoryBucket implements ProfileStateBucketLike {
  private readonly values = new Map<string, unknown>()

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value)
    }
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key)
      return
    }

    this.values.set(key, value)
  }
}

function makeProfile(id: string): ProfileSummary {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    planType: 'pro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeDeps(
  overrides: Partial<ActiveProfileStateDependencies> & {
    currentBucket?: MemoryBucket
    legacyBucket?: MemoryBucket
  } = {},
): {
  currentBucket: MemoryBucket
  legacyBucket: MemoryBucket
  sharedWrites: string[]
  deps: ActiveProfileStateDependencies
} {
  const {
    currentBucket = new MemoryBucket(),
    legacyBucket = new MemoryBucket(),
    ...rest
  } = overrides
  const sharedWrites: string[] = []

  return {
    currentBucket,
    legacyBucket,
    sharedWrites,
    deps: {
      isRemoteFilesMode: false,
      currentBucket,
      legacyBucket,
      keys: { current: 'current', currentBase: 'base', legacy: 'legacy' },
      shouldMigrateLegacyProfileState: false,
      readSharedActiveProfile: () => undefined,
      writeSharedActiveProfile: (profileId) => {
        sharedWrites.push(profileId)
      },
      getProfile: async () => undefined,
      inferActiveProfileIdFromAuthFile: async () => undefined,
      inheritDefaultProfileIfCurrentHomeIsEmpty: async () => undefined,
      ...rest,
    },
  }
}

function makeWriteDeps(
  overrides: Partial<ActiveProfileStateWriteDependencies> & {
    currentBucket?: MemoryBucket
  } = {},
): {
  currentBucket: MemoryBucket
  sharedWrites: string[]
  deletedCount: () => number
  deps: ActiveProfileStateWriteDependencies
} {
  const { currentBucket = new MemoryBucket(), ...rest } = overrides
  const sharedWrites: string[] = []
  let deleted = 0

  return {
    currentBucket,
    sharedWrites,
    deletedCount: () => deleted,
    deps: {
      isRemoteFilesMode: false,
      currentBucket,
      keys: { current: 'current', legacy: 'legacy' },
      writeSharedActiveProfile: (profileId) => {
        sharedWrites.push(profileId)
      },
      deleteSharedActiveProfile: () => {
        deleted += 1
      },
      ...rest,
    },
  }
}

test('resolveActiveProfileId prefers inferred remote auth and syncs shared state', async () => {
  const { deps, sharedWrites } = makeDeps({
    isRemoteFilesMode: true,
    readSharedActiveProfile: () => 'shared',
    inferActiveProfileIdFromAuthFile: async () => 'inferred',
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default',
  })

  assert.equal(await resolveActiveProfileId(deps), 'inferred')
  assert.deepEqual(sharedWrites, ['inferred'])
})

test('resolveActiveProfileId falls back to shared remote or inherited default', async () => {
  const explicit = makeDeps({
    isRemoteFilesMode: true,
    readSharedActiveProfile: () => 'shared',
    inferActiveProfileIdFromAuthFile: async () => undefined,
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default',
  })

  assert.equal(await resolveActiveProfileId(explicit.deps), 'shared')
  assert.deepEqual(explicit.sharedWrites, [])

  const synced = makeDeps({
    isRemoteFilesMode: true,
    readSharedActiveProfile: () => 'shared',
    inferActiveProfileIdFromAuthFile: async () => 'shared',
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default',
  })

  assert.equal(await resolveActiveProfileId(synced.deps), 'shared')
  assert.deepEqual(synced.sharedWrites, [])

  const inherited = makeDeps({
    isRemoteFilesMode: true,
    readSharedActiveProfile: () => undefined,
    inferActiveProfileIdFromAuthFile: async () => undefined,
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default',
  })

  assert.equal(await resolveActiveProfileId(inherited.deps), 'default')
  assert.deepEqual(inherited.sharedWrites, [])
})

test('resolveActiveProfileId returns the current local profile when it exists', async () => {
  const { deps } = makeDeps({
    currentBucket: new MemoryBucket({ current: 'active' }),
    getProfile: async (profileId) =>
      profileId === 'active' ? makeProfile(profileId) : undefined,
  })

  assert.equal(await resolveActiveProfileId(deps), 'active')
  assert.equal(deps.currentBucket.get('current'), 'active')
  assert.equal(deps.currentBucket.get('legacy'), undefined)
})

test('resolveActiveProfileId replaces stale local state with inferred auth', async () => {
  const { deps } = makeDeps({
    currentBucket: new MemoryBucket({ current: 'stale', legacy: 'legacy' }),
    getProfile: async () => undefined,
    inferActiveProfileIdFromAuthFile: async () => 'fresh',
  })

  assert.equal(await resolveActiveProfileId(deps), 'fresh')
  assert.equal(deps.currentBucket.get('current'), 'fresh')
  assert.equal(deps.currentBucket.get('legacy'), undefined)

  const clearing = makeDeps({
    currentBucket: new MemoryBucket({ current: 'stale', legacy: 'legacy' }),
    getProfile: async () => undefined,
    inferActiveProfileIdFromAuthFile: async () => undefined,
  })

  assert.equal(await resolveActiveProfileId(clearing.deps), undefined)
  assert.equal(clearing.currentBucket.get('current'), undefined)
  assert.equal(clearing.currentBucket.get('legacy'), undefined)
})

test('resolveActiveProfileId migrates legacy state and inherits default home when empty', async () => {
  const migrating = makeDeps({
    currentBucket: new MemoryBucket({ base: 'legacy-active' }),
    legacyBucket: new MemoryBucket({ legacy: 'legacy-old' }),
    shouldMigrateLegacyProfileState: true,
    getProfile: async (profileId) =>
      profileId === 'legacy-active' ? makeProfile(profileId) : undefined,
    inferActiveProfileIdFromAuthFile: async () => undefined,
  })

  assert.equal(await resolveActiveProfileId(migrating.deps), 'legacy-active')
  assert.equal(migrating.currentBucket.get('current'), 'legacy-active')
  assert.equal(migrating.currentBucket.get('base'), undefined)
  assert.equal(migrating.currentBucket.get('legacy'), undefined)
  assert.equal(migrating.legacyBucket.get('legacy'), undefined)

  const fallback = makeDeps({
    shouldMigrateLegacyProfileState: true,
    inferActiveProfileIdFromAuthFile: async () => undefined,
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default-home',
  })

  assert.equal(await resolveActiveProfileId(fallback.deps), 'default-home')
  assert.equal(fallback.currentBucket.get('current'), undefined)
  assert.equal(fallback.currentBucket.get('base'), undefined)

  const migrated = makeDeps({
    currentBucket: new MemoryBucket({ base: 'legacy-missing' }),
    shouldMigrateLegacyProfileState: true,
    getProfile: async () => undefined,
    inferActiveProfileIdFromAuthFile: async () => 'migrated',
  })

  assert.equal(await resolveActiveProfileId(migrated.deps), 'migrated')
  assert.equal(migrated.currentBucket.get('current'), 'migrated')
  assert.equal(migrated.currentBucket.get('base'), undefined)
  assert.equal(migrated.currentBucket.get('legacy'), undefined)
  assert.equal(migrated.legacyBucket.get('legacy'), undefined)

  const inherited = makeDeps({
    currentBucket: new MemoryBucket({ base: 'stale' }),
    shouldMigrateLegacyProfileState: false,
    inferActiveProfileIdFromAuthFile: async () => undefined,
    inheritDefaultProfileIfCurrentHomeIsEmpty: async () => 'default-home',
  })

  assert.equal(await resolveActiveProfileId(inherited.deps), 'default-home')
  assert.equal(inherited.currentBucket.get('current'), undefined)
  assert.equal(inherited.currentBucket.get('base'), 'stale')

  const inferred = makeDeps({
    inferActiveProfileIdFromAuthFile: async () => 'fresh-home',
  })

  assert.equal(await resolveActiveProfileId(inferred.deps), 'fresh-home')
  assert.equal(inferred.currentBucket.get('current'), 'fresh-home')
  assert.equal(inferred.currentBucket.get('legacy'), undefined)
})

test('setActiveProfileIdInState writes remote and local active state', async () => {
  const remote = makeWriteDeps({
    isRemoteFilesMode: true,
  })

  await setActiveProfileIdInState(remote.deps, 'remote-active')
  await setActiveProfileIdInState(remote.deps, undefined)

  assert.deepEqual(remote.sharedWrites, ['remote-active'])
  assert.equal(remote.deletedCount(), 1)
  assert.equal(remote.currentBucket.get('current'), undefined)

  const local = makeWriteDeps({
    currentBucket: new MemoryBucket({ legacy: 'old' }),
  })

  await setActiveProfileIdInState(local.deps, 'local-active')

  assert.equal(local.currentBucket.get('current'), 'local-active')
  assert.equal(local.currentBucket.get('legacy'), undefined)
})
