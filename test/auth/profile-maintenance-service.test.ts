import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProfileSummary } from '../../src/types'
import type { ProfileMaintenanceRunResult } from '../../src/auth/profile-rate-limit-service'
import {
  ProfileMaintenanceService,
  isProfileDue,
  type MaintenanceFileSystem,
} from '../../src/auth/profile-maintenance-service'
import {
  buildMaintenancePaths,
  computeProductScopeHash,
} from '../../src/utils/profile-maintenance-paths'
import {
  MaintenanceLease,
  type LeaseDiagnostics,
} from '../../src/utils/profile-maintenance-lease'

const diagnostics: LeaseDiagnostics = {
  pid: 1,
  sessionId: 's',
  appName: 'Visual Studio Code',
  uriScheme: 'vscode',
  ideVersion: '1.0.0',
  extensionVersion: '1.4.0',
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

class FakeFs implements MaintenanceFileSystem {
  readonly files = new Map<string, string>()

  async mkdir(): Promise<undefined> {
    return undefined
  }

  async writeFile(
    filePath: string,
    data: string,
    options: { flag?: string },
  ): Promise<void> {
    if (options.flag === 'wx' && this.files.has(filePath)) {
      throw errno('EEXIST')
    }
    this.files.set(filePath, data)
  }

  async readFile(filePath: string): Promise<string> {
    const value = this.files.get(filePath)
    if (value === undefined) {
      throw errno('ENOENT')
    }
    return value
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = this.files.get(oldPath)
    if (value === undefined) {
      throw errno('ENOENT')
    }
    this.files.set(newPath, value)
    this.files.delete(oldPath)
  }

  async unlink(filePath: string): Promise<void> {
    if (!this.files.has(filePath)) {
      throw errno('ENOENT')
    }
    this.files.delete(filePath)
  }
}

function makeProfile(id: string): ProfileSummary {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    planType: 'pro',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

const scope = computeProductScopeHash({
  appName: 'Visual Studio Code',
  uriScheme: 'vscode',
  globalStorageFsPath: '/g',
  profileStorageBackend: 'secretStorage',
})
const paths = buildMaintenancePaths(scope, '/home')

let uuidCounter = 0

interface Harness {
  fs: FakeFs
  clock: { value: number }
  runCalls: string[]
  profiles: ProfileSummary[]
}

function makeService(
  harness: Harness,
  options: {
    interval?: () => number
    run?: (profile: ProfileSummary) => Promise<ProfileMaintenanceRunResult>
  } = {},
) {
  const run =
    options.run ??
    (async (profile: ProfileSummary) => {
      harness.runCalls.push(profile.id)
      return {
        status: 'success' as const,
        rateLimits: {
          fiveHour: { usedPercent: 10, remainingPercent: 90, resetsAt: null },
          weekly: null,
        },
      }
    })

  const profileManager = {
    listProfiles: async () => [...harness.profiles],
    getProfile: async (id: string) => harness.profiles.find((p) => p.id === id),
  }

  return new ProfileMaintenanceService({
    paths,
    diagnostics,
    fs: harness.fs,
    profileManager: profileManager as never,
    runProfileMaintenance: (_pm, profile) => run(profile),
    getIntervalSeconds: options.interval ?? (() => 900),
    now: () => harness.clock.value,
    random: () => 0,
    uuid: () => `id-${uuidCounter++}`,
    debugLog: () => undefined,
  })
}

function makeHarness(profiles: ProfileSummary[]): Harness {
  return {
    fs: new FakeFs(),
    clock: { value: 1_000_000 },
    runCalls: [],
    profiles,
  }
}

test('isProfileDue treats missing, overdue, and retryable states as due', () => {
  assert.equal(isProfileDue(null, 100), true)
  assert.equal(
    isProfileDue(
      {
        schemaVersion: 1,
        generation: 1,
        status: 'success',
        lastAttemptAt: 0,
        lastSuccessAt: 0,
        nextDueAt: 200,
        nextRetryAt: null,
        consecutiveFailures: 0,
      },
      100,
    ),
    false,
  )
  assert.equal(
    isProfileDue(
      {
        schemaVersion: 1,
        generation: 1,
        status: 'failed',
        lastAttemptAt: 0,
        lastSuccessAt: null,
        nextDueAt: null,
        nextRetryAt: 50,
        consecutiveFailures: 1,
      },
      100,
    ),
    true,
  )
})

test('one window processes all due profiles serially and releases the lease', async () => {
  const harness = makeHarness([makeProfile('a'), makeProfile('b')])
  const service = makeService(harness)

  await service.requestCycle()

  assert.deepEqual(harness.runCalls.sort(), ['a', 'b'])
  assert.equal(harness.fs.files.has(paths.leaseFile), false)
  assert.ok(await service.readProfileState('a'))
  assert.ok(await service.readProfileState('b'))
})

test('a fresh lease held by another window blocks a cycle', async () => {
  const harness = makeHarness([makeProfile('a')])
  const other = new MaintenanceLease(paths.leaseFile, diagnostics, {
    fs: harness.fs,
    now: () => harness.clock.value,
    uuid: () => `other-${uuidCounter++}`,
  })
  assert.ok(
    await other.tryAcquire({
      status: 'refreshing',
      profilesTotal: 1,
      profilesCompleted: 0,
    }),
  )

  const service = makeService(harness)
  await service.requestCycle()

  assert.deepEqual(harness.runCalls, [])
})

test('fresh profiles are skipped while profiles without state are due', async () => {
  const harness = makeHarness([makeProfile('fresh'), makeProfile('new')])
  // Seed a fresh state for "fresh".
  const seedService = makeService(harness)
  await seedService.requestCycle()
  harness.runCalls.length = 0

  // Advance slightly, well within the interval, then run again.
  harness.clock.value += 1000
  // Remove the state for "new" by deleting its file so it looks unseen.
  harness.fs.files.delete(paths.profileStateFile('new'))

  const service = makeService(harness)
  await service.requestCycle()

  assert.deepEqual(harness.runCalls, ['new'])
})

test('manual force bypasses freshness', async () => {
  const harness = makeHarness([makeProfile('a')])
  await makeService(harness).requestCycle()
  harness.runCalls.length = 0

  const service = makeService(harness)
  await service.requestCycle({ forceProfileIds: ['a'] })

  assert.deepEqual(harness.runCalls, ['a'])
})

test('interval 0 disables background work but still allows manual refresh', async () => {
  const harness = makeHarness([makeProfile('a')])
  const service = makeService(harness, { interval: () => 0 })

  await service.requestCycle()
  assert.deepEqual(harness.runCalls, [])

  await service.requestCycle({ forceProfileIds: ['a'] })
  assert.deepEqual(harness.runCalls, ['a'])
})

test('failure records retry backoff and preserves the last successful usage', async () => {
  const harness = makeHarness([makeProfile('a')])
  await makeService(harness).requestCycle()
  const success = await makeService(harness).readProfileState('a')
  assert.ok(success?.rateLimits)

  harness.clock.value += 901_000

  const failing = makeService(harness, {
    run: async () => ({
      status: 'failed',
      rateLimits: null,
      errorCategory: 'process-failed',
    }),
  })
  await failing.requestCycle()

  const state = await failing.readProfileState('a')
  assert.equal(state?.status, 'failed')
  assert.equal(state?.errorCategory, 'process-failed')
  assert.equal(state?.consecutiveFailures, 1)
  assert.ok((state?.nextRetryAt ?? 0) > harness.clock.value)
  assert.ok(state?.lastSuccessAt)
  assert.deepEqual(state?.rateLimits, success?.rateLimits)
})

test('a profile deleted mid-cycle has its result discarded', async () => {
  const harness = makeHarness([makeProfile('a')])
  const service = makeService(harness, {
    run: async (profile) => {
      harness.runCalls.push(profile.id)
      // Simulate concurrent deletion during the maintenance request.
      harness.profiles = harness.profiles.filter((p) => p.id !== 'a')
      return { status: 'success', rateLimits: null }
    },
  })

  await service.requestCycle()

  assert.deepEqual(harness.runCalls, ['a'])
  assert.equal(await service.readProfileState('a'), null)
})

test('losing the lease before publishing discards the result', async () => {
  const harness = makeHarness([makeProfile('a')])
  const service = makeService(harness, {
    run: async (profile) => {
      harness.runCalls.push(profile.id)
      // Another window steals the lease before this result can be published.
      harness.fs.files.set(
        paths.leaseFile,
        JSON.stringify({ leaseId: 'stolen', heartbeatAt: harness.clock.value }),
      )
      return { status: 'success', rateLimits: null }
    },
  })

  await service.requestCycle()

  assert.deepEqual(harness.runCalls, ['a'])
  assert.equal(await service.readProfileState('a'), null)
})

test('state published by one window is visible to another', async () => {
  const harness = makeHarness([makeProfile('a')])
  await makeService(harness).requestCycle()

  const reader = makeService(harness)
  const state = await reader.readProfileState('a')
  assert.equal(state?.status, 'success')
})

test('two concurrent windows produce a single maintenance pass', async () => {
  const harness = makeHarness([makeProfile('a'), makeProfile('b')])
  const serviceA = makeService(harness)
  const serviceB = makeService(harness)

  await Promise.all([serviceA.requestCycle(), serviceB.requestCycle()])

  assert.deepEqual(harness.runCalls.sort(), ['a', 'b'])
})
