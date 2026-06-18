import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import type { AuthData, ProfileSummary } from '../../src/types'
import { ProfileRateLimitService } from '../../src/auth/profile-rate-limit-service'

interface ParsedRequest {
  id?: number | string
  method: string
  params?: unknown
  responded?: boolean
}

class FakeAppServer extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  readonly requests: ParsedRequest[] = []
  readonly killSignals: Array<string | undefined> = []
  exitCode: number | null = null
  signalCode: string | null = null

  private buffer = ''

  constructor(
    private readonly behavior: {
      rateLimitsResult: unknown
      autoRespondInitialize?: boolean
      autoRespondRateLimits?: boolean
      autoRespondShutdown?: boolean
    },
  ) {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk) => {
      this.buffer += chunk
      let newlineIndex = this.buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim()
        this.buffer = this.buffer.slice(newlineIndex + 1)
        if (line) {
          this.handleRequest(JSON.parse(line) as ParsedRequest)
        }
        newlineIndex = this.buffer.indexOf('\n')
      }
    })
  }

  respondTo(method: string): void {
    const request = this.requests.find(
      (entry) => entry.method === method && !entry.responded,
    )
    if (!request || request.id === undefined) {
      return
    }

    request.responded = true
    this.stdout.write(
      `${JSON.stringify({
        id: request.id,
        result:
          method === 'account/rateLimits/read'
            ? this.behavior.rateLimitsResult
            : {},
      })}\n`,
    )
  }

  private handleRequest(request: ParsedRequest): void {
    this.requests.push(request)
    this.emit('request', request)

    if (
      request.method === 'initialize' &&
      this.behavior.autoRespondInitialize
    ) {
      this.respondTo('initialize')
    }

    if (
      request.method === 'account/rateLimits/read' &&
      this.behavior.autoRespondRateLimits
    ) {
      this.respondTo('account/rateLimits/read')
    }

    if (request.method === 'shutdown' && this.behavior.autoRespondShutdown) {
      this.respondTo('shutdown')
    }
  }

  kill(signal?: string): boolean {
    this.killSignals.push(signal)
    if (this.exitCode === null && this.signalCode === null) {
      this.exitCode = signal ? null : 0
      this.signalCode = signal ?? null
      queueMicrotask(() => {
        this.emit('exit', this.exitCode, this.signalCode)
      })
    }
    return true
  }
}

function makeProfile(
  id: string,
  updatedAt = '2026-06-12T10:00:00.000Z',
): ProfileSummary {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    planType: 'pro',
    createdAt: updatedAt,
    updatedAt,
  }
}

function makeAuth(id: string): AuthData {
  return {
    idToken: `${id}-id`,
    accessToken: `${id}-access`,
    refreshToken: `${id}-refresh`,
    email: `${id}@example.com`,
    planType: 'pro',
    authJson: {
      tokens: {
        id_token: `${id}-id`,
        access_token: `${id}-access`,
        refresh_token: `${id}-refresh`,
      },
    },
  }
}

function makeHarness(
  behavior: ConstructorParameters<typeof FakeAppServer>[0],
  overrides: {
    now?: () => number
    unlinkFails?: boolean
  } = {},
) {
  const writes: Array<[string, string, unknown]> = []
  const unlinks: string[] = []
  const rms: string[] = []
  const child = new FakeAppServer(behavior)
  const tempHomeFs = {
    mkdtemp: async () => '/tmp/codex-switch-rate-limits-1',
    chmod: async () => undefined,
    writeFile: async (filePath: string, content: string, options: unknown) => {
      writes.push([filePath, content, options])
    },
    unlink: async (filePath: string) => {
      unlinks.push(filePath)
      if (overrides.unlinkFails) {
        throw new Error('unlink failed')
      }
    },
    rm: async (filePath: string) => {
      rms.push(filePath)
    },
  } as any

  const service = new ProfileRateLimitService('1.4.0', {
    now: overrides.now ?? (() => 1_700_000_000_000),
    tmpdir: () => '/tmp',
    resolveCodexCliCommand: () => ({ command: 'codex', args: [] }),
    spawnAppServer: () => child as any,
    tempHomeFs,
    env: {} as NodeJS.ProcessEnv,
    debugLog: () => undefined,
  })

  const profileManager = {
    loadAuthData: async (profileId: string) => makeAuth(profileId),
    getProfile: async (profileId: string) => makeProfile(profileId),
  } as any

  return {
    child,
    profileManager,
    service,
    rms,
    unlinks,
    writes,
  }
}

function waitForRequest(child: FakeAppServer, method: string): Promise<void> {
  if (child.requests.some((request) => request.method === method)) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const onRequest = () => {
      if (child.requests.some((request) => request.method === method)) {
        child.off('request', onRequest)
        resolve()
      }
    }
    child.on('request', onRequest)
  })
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('ProfileRateLimitService fetches, caches, and reuses rate limits', async () => {
  const harness = makeHarness({
    rateLimitsResult: {
      rateLimits: {
        primary: {
          usedPercent: 25,
          windowDurationMins: 300,
          resetsAt: 1_700_000_060,
        },
      },
    },
    autoRespondInitialize: true,
    autoRespondRateLimits: true,
    autoRespondShutdown: true,
  })
  const profile = makeProfile('profile-1')

  const first = await harness.service.decorateProfiles(harness.profileManager, [
    profile,
  ])
  const second = await harness.service.decorateProfiles(
    harness.profileManager,
    [profile],
  )

  assert.equal(first[0]?.rateLimits?.fiveHour?.usedPercent, 25)
  assert.equal(first[0]?.rateLimits?.fiveHour?.remainingPercent, 75)
  assert.equal(first[0]?.rateLimits?.weekly, null)
  assert.deepEqual(second, first)
  assert.equal(
    harness.child.requests.filter((request) => request.method === 'initialize')
      .length,
    1,
  )
  assert.equal(
    harness.child.requests.filter(
      (request) => request.method === 'account/rateLimits/read',
    ).length,
    1,
  )
  assert.ok(
    harness.writes.some(
      ([filePath, content, options]) =>
        path.basename(filePath) === 'auth.json' &&
        typeof content === 'string' &&
        content.includes('"tokens"') &&
        (options as { mode?: number }).mode === 0o600,
    ),
  )
  assert.equal(
    path.basename(harness.rms[0] ?? ''),
    'codex-switch-rate-limits-1',
  )
})

test('ProfileRateLimitService deduplicates inflight rate-limit refreshes', async () => {
  const harness = makeHarness({
    rateLimitsResult: {
      rateLimits: {
        primary: {
          usedPercent: 12,
          windowDurationMins: 300,
        },
      },
    },
    autoRespondInitialize: false,
    autoRespondRateLimits: false,
    autoRespondShutdown: true,
  })
  const profile = makeProfile('profile-1')

  const first = harness.service.decorateProfiles(harness.profileManager, [
    profile,
  ])
  await waitForRequest(harness.child, 'initialize')
  const second = harness.service.decorateProfiles(harness.profileManager, [
    profile,
  ])

  assert.equal(
    harness.child.requests.filter((request) => request.method === 'initialize')
      .length,
    1,
  )

  harness.child.respondTo('initialize')
  await waitForRequest(harness.child, 'account/rateLimits/read')
  harness.child.respondTo('account/rateLimits/read')

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult, secondResult)
  assert.equal(firstResult[0]?.rateLimits?.fiveHour?.usedPercent, 12)
})

test('ProfileRateLimitService cancels inflight work and removes temp auth cleanup fallback files', async () => {
  const harness = makeHarness(
    {
      rateLimitsResult: {
        rateLimits: {
          primary: {
            usedPercent: 33,
            windowDurationMins: 300,
          },
        },
      },
      autoRespondInitialize: true,
      autoRespondRateLimits: false,
      autoRespondShutdown: true,
    },
    {
      unlinkFails: true,
    },
  )
  const profile = makeProfile('profile-1')

  const decorate = harness.service.decorateProfiles(harness.profileManager, [
    profile,
  ])
  await waitForRequest(harness.child, 'account/rateLimits/read')
  harness.service.cancelPendingWork()
  await waitForCondition(() => harness.child.killSignals.length > 0)

  const result = await decorate
  assert.deepEqual(result, [
    {
      ...profile,
      rateLimits: null,
    },
  ])
  assert.ok(harness.child.killSignals.length > 0)
  assert.equal(path.basename(harness.unlinks[0] ?? ''), 'auth.json')
  assert.ok(
    harness.writes.some(
      ([filePath, content]) =>
        path.basename(filePath) === 'auth.json' && content === '{}',
    ),
  )
  assert.equal(
    path.basename(harness.rms[0] ?? ''),
    'codex-switch-rate-limits-1',
  )
})
