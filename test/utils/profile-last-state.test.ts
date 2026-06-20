/** Tests for profile-last-state. */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readLastProfileIdFromState,
  toggleLastProfileId,
  writeLastProfileIdToState,
  type ProfileStateBucketLike,
} from '../../src/utils/profile-last-state'

class MemoryBucket implements ProfileStateBucketLike {
  private values = new Map<string, unknown>()

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

test('readLastProfileIdFromState reads current and migrates legacy state', async () => {
  const bucket = new MemoryBucket()
  const legacyBucket = new MemoryBucket()

  await bucket.update('last.home', 'current')
  assert.equal(
    await readLastProfileIdFromState(
      bucket,
      legacyBucket,
      { current: 'last.home', currentBase: 'last', legacy: 'old.last' },
      true,
    ),
    'current',
  )

  const migratingBucket = new MemoryBucket()
  const migratingLegacyBucket = new MemoryBucket()
  await migratingBucket.update('last', 'legacy')
  assert.equal(
    await readLastProfileIdFromState(
      migratingBucket,
      migratingLegacyBucket,
      { current: 'last.home', currentBase: 'last', legacy: 'old.last' },
      true,
    ),
    'legacy',
  )
  assert.equal(migratingBucket.get('last.home'), 'legacy')
  assert.equal(migratingBucket.get('last'), undefined)
  assert.equal(migratingLegacyBucket.get('old.last'), undefined)

  const noMigrateBucket = new MemoryBucket()
  await noMigrateBucket.update('last', 'legacy')
  assert.equal(
    await readLastProfileIdFromState(
      noMigrateBucket,
      new MemoryBucket(),
      { current: 'last.home', currentBase: 'last', legacy: 'old.last' },
      false,
    ),
    undefined,
  )

  assert.equal(
    await readLastProfileIdFromState(
      new MemoryBucket(),
      new MemoryBucket(),
      { current: 'last.home', currentBase: 'last', legacy: 'old.last' },
      true,
    ),
    undefined,
  )
})

test('writeLastProfileIdToState updates current and clears legacy', async () => {
  const bucket = new MemoryBucket()
  await bucket.update('old.last', 'legacy')

  await writeLastProfileIdToState(
    bucket,
    {
      current: 'last.home',
      currentBase: 'last',
      legacy: 'old.last',
    },
    'new',
  )

  assert.equal(bucket.get('last.home'), 'new')
  assert.equal(bucket.get('old.last'), undefined)
})

test('toggleLastProfileId swaps active and last ids', async () => {
  const setActiveCalls: string[] = []
  const setLastCalls: Array<string | undefined> = []

  assert.equal(
    await toggleLastProfileId(
      'active',
      'last',
      async (profileId) => {
        setActiveCalls.push(profileId)
        return true
      },
      async (profileId) => {
        setLastCalls.push(profileId)
      },
    ),
    'last',
  )
  assert.deepEqual(setActiveCalls, ['last'])
  assert.deepEqual(setLastCalls, ['active'])

  assert.equal(
    await toggleLastProfileId(
      'active',
      undefined,
      async () => true,
      async () => undefined,
    ),
    undefined,
  )

  assert.equal(
    await toggleLastProfileId(
      undefined,
      'last',
      async () => true,
      async () => undefined,
    ),
    'last',
  )

  assert.equal(
    await toggleLastProfileId(
      'active',
      'last',
      async () => false,
      async () => undefined,
    ),
    undefined,
  )
})
