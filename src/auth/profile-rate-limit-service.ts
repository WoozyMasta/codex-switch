import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { buildCodexAuthJson } from './codex-auth-sync'
import { ProfileManager } from './profile-manager'
import {
  AuthData,
  ProfileRateLimitWindow,
  ProfileRateLimits,
  ProfileSummary,
} from '../types'
import { resolveCodexCliCommand } from '../utils/codex-cli-resolver'
import { debugLog } from '../utils/log'

const RATE_LIMIT_CACHE_TTL_MS = 60 * 1000
const APP_SERVER_REQUEST_TIMEOUT_MS = 5_000
const APP_SERVER_EXIT_TIMEOUT_MS = 2_000
const FIVE_HOUR_WINDOW_MINUTES = 5 * 60
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60
const CODEX_LIMIT_ID = 'codex'
const RATE_LIMIT_FAILURE_BACKOFF_MS = 30 * 1000

type JsonRpcId = number | string

interface JsonRpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

interface JsonRpcSuccessResponse {
  id: JsonRpcId
  result: unknown
}

interface JsonRpcErrorResponse {
  id: JsonRpcId
  error: JsonRpcErrorPayload
}

interface CacheEntry {
  profileUpdatedAt: string
  fetchedAt: number
  rateLimits: ProfileRateLimits | null
  lastFailureAt?: number
}

interface DecorateProfilesOptions {
  forceRefresh?: boolean
  forceRefreshProfileIds?: readonly string[]
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lineReader: readline.Interface
  private readonly pendingRequests = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly stderrChunks: string[] = []
  private nextRequestId = 1

  constructor(codexHomePath: string) {
    const env = {
      ...process.env,
      CODEX_HOME: codexHomePath,
    }

    this.child = spawnAppServer(env)
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      if (this.stderrChunks.length >= 10) {
        this.stderrChunks.shift()
      }
      this.stderrChunks.push(chunk.trim())
    })

    this.lineReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })
    this.lineReader.on('line', (line) => {
      this.handleLine(line)
    })

    this.child.on('error', (error) => {
      this.rejectAllPending(
        new Error(`Failed to start Codex app-server: ${error.message}`),
      )
    })
    this.child.on('exit', (code, signal) => {
      this.rejectAllPending(
        new Error(
          `Codex app-server exited before completing the request (${formatExitReason(code, signal)}).${this.getStderrSuffix()}`,
        ),
      )
    })
  }

  async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'codex-switch',
        title: null,
        version: '1.3.1',
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: [],
      },
    })
  }

  async readRateLimits(): Promise<unknown> {
    return await this.sendRequest('account/rateLimits/read')
  }

  async dispose(): Promise<void> {
    this.lineReader.close()
    this.rejectAllPending(new Error('Codex app-server request was canceled.'))

    if (!this.child.killed) {
      this.child.kill()
    }

    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return
    }

    await Promise.race([
      once(this.child, 'exit'),
      new Promise((resolve) => {
        setTimeout(resolve, APP_SERVER_EXIT_TIMEOUT_MS)
      }),
    ])
  }

  private async sendRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    const id = this.nextRequestId++

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(
          new Error(
            `Timed out waiting for Codex app-server response to ${method}.${this.getStderrSuffix()}`,
          ),
        )
      }, APP_SERVER_REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timer })

      const payload: Record<string, unknown> = {
        id,
        method,
      }
      if (params !== undefined) {
        payload.params = params
      }

      this.child.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    let message:
      | JsonRpcSuccessResponse
      | JsonRpcErrorResponse
      | { id?: JsonRpcId; method?: string }
    try {
      message = JSON.parse(trimmed)
    } catch (error) {
      debugLog('Ignoring non-JSON stdout from Codex app-server:', error)
      return
    }

    if (message.id === undefined) {
      return
    }

    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      return
    }

    clearTimeout(pending.timer)
    this.pendingRequests.delete(message.id)

    if ('error' in message) {
      pending.reject(new Error(message.error.message))
      return
    }

    if (!('result' in message)) {
      pending.reject(
        new Error('Codex app-server returned an invalid response.'),
      )
      return
    }

    pending.resolve(message.result)
  }

  private rejectAllPending(error: Error): void {
    if (this.pendingRequests.size === 0) {
      return
    }

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private getStderrSuffix(): string {
    const stderr = this.stderrChunks.filter(Boolean).join(' ')
    return stderr ? ` Stderr: ${stderr}` : ''
  }
}

export class ProfileRateLimitService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<
    string,
    Promise<ProfileRateLimits | null>
  >()
  private readonly appServerConcurrencyLimit = 2
  private appServerActiveCount = 0
  private readonly appServerWaitQueue: Array<() => void> = []

  applyCachedRateLimits(profiles: ProfileSummary[]): ProfileSummary[] {
    return profiles.map((profile) => ({
      ...profile,
      rateLimits: this.getCachedRateLimits(profile),
    }))
  }

  async decorateProfiles(
    profileManager: ProfileManager,
    profiles: ProfileSummary[],
    options: DecorateProfilesOptions = {},
  ): Promise<ProfileSummary[]> {
    const forceRefreshIds = new Set(options.forceRefreshProfileIds || [])

    return await Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        rateLimits: await this.getRateLimits(
          profileManager,
          profile,
          options.forceRefresh === true || forceRefreshIds.has(profile.id),
        ),
      })),
    )
  }

  private getFreshCachedRateLimits(
    profile: ProfileSummary,
  ): ProfileRateLimits | null | undefined {
    const entry = this.cache.get(profile.id)
    if (!entry) {
      return undefined
    }

    if (!this.isFresh(profile, entry)) {
      return undefined
    }

    return entry.rateLimits
  }

  private getCachedRateLimits(
    profile: ProfileSummary,
  ): ProfileRateLimits | null | undefined {
    const entry = this.cache.get(profile.id)
    if (!entry || entry.profileUpdatedAt !== profile.updatedAt) {
      return undefined
    }

    return entry.rateLimits
  }

  private async getRateLimits(
    profileManager: ProfileManager,
    profile: ProfileSummary,
    forceRefresh = false,
  ): Promise<ProfileRateLimits | null> {
    const existing = this.inflight.get(profile.id)
    if (existing) {
      return await existing
    }

    if (!forceRefresh) {
      const cached = this.getFreshCachedRateLimits(profile)
      if (cached !== undefined) {
        return cached
      }

      const staleCached = this.getCachedRateLimits(profile)
      if (this.shouldSkipRefreshAfterFailure(profile)) {
        return staleCached ?? null
      }
    }

    const promise = this.fetchRateLimits(profileManager, profile)
    this.inflight.set(profile.id, promise)

    try {
      return await promise
    } finally {
      this.inflight.delete(profile.id)
    }
  }

  private async fetchRateLimits(
    profileManager: ProfileManager,
    profile: ProfileSummary,
  ): Promise<ProfileRateLimits | null> {
    const authData = await profileManager.loadAuthData(profile.id)
    if (!authData) {
      this.cacheFailure(profile)
      return null
    }

    try {
      const rateLimits = await this.runWithAppServerConcurrencyLimit(() =>
        queryRateLimitsViaTemporaryCodexHome(authData),
      )
      this.cacheSuccess(profile, rateLimits)
      return rateLimits
    } catch (error) {
      debugLog(
        `Rate limits unavailable for profile ${profile.id}:`,
        error instanceof Error ? error.message : error,
      )
      this.cacheFailure(profile)
      return null
    }
  }

  private async runWithAppServerConcurrencyLimit<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    await this.acquireAppServerSlot()
    try {
      return await task()
    } finally {
      this.releaseAppServerSlot()
    }
  }

  private async acquireAppServerSlot(): Promise<void> {
    if (this.appServerActiveCount < this.appServerConcurrencyLimit) {
      this.appServerActiveCount += 1
      return
    }

    await new Promise<void>((resolve) => {
      this.appServerWaitQueue.push(resolve)
    })
    this.appServerActiveCount += 1
  }

  private releaseAppServerSlot(): void {
    this.appServerActiveCount = Math.max(this.appServerActiveCount - 1, 0)
    const next = this.appServerWaitQueue.shift()
    if (next) {
      next()
    }
  }

  private cacheSuccess(
    profile: ProfileSummary,
    rateLimits: ProfileRateLimits | null,
  ): void {
    this.cache.set(profile.id, {
      profileUpdatedAt: profile.updatedAt,
      fetchedAt: Date.now(),
      rateLimits,
    })
  }

  private cacheFailure(profile: ProfileSummary): void {
    const existing = this.cache.get(profile.id)
    if (existing && existing.profileUpdatedAt === profile.updatedAt) {
      this.cache.set(profile.id, {
        ...existing,
        lastFailureAt: Date.now(),
      })
      return
    }

    this.cache.set(profile.id, {
      profileUpdatedAt: profile.updatedAt,
      fetchedAt: Date.now(),
      rateLimits: null,
      lastFailureAt: Date.now(),
    })
  }

  private shouldSkipRefreshAfterFailure(profile: ProfileSummary): boolean {
    const entry = this.cache.get(profile.id)
    if (!entry || entry.profileUpdatedAt !== profile.updatedAt) {
      return false
    }

    if (entry.lastFailureAt === undefined) {
      return false
    }

    return Date.now() - entry.lastFailureAt < RATE_LIMIT_FAILURE_BACKOFF_MS
  }

  private isFresh(profile: ProfileSummary, entry: CacheEntry): boolean {
    return (
      entry.profileUpdatedAt === profile.updatedAt &&
      Date.now() - entry.fetchedAt < RATE_LIMIT_CACHE_TTL_MS
    )
  }
}

async function queryRateLimitsViaTemporaryCodexHome(
  authData: AuthData,
): Promise<ProfileRateLimits | null> {
  const tempHomePath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-switch-rate-limits-'),
  )
  const authFilePath = path.join(tempHomePath, 'auth.json')

  try {
    await fs.chmod(tempHomePath, 0o700).catch(() => undefined)
    await fs.writeFile(authFilePath, buildCodexAuthJson(authData), {
      encoding: 'utf8',
      mode: 0o600,
    })

    const client = new CodexAppServerClient(tempHomePath)
    try {
      await client.initialize()
      const response = await client.readRateLimits()
      return normalizeRateLimitResponse(response, Math.floor(Date.now() / 1000))
    } finally {
      await client.dispose()
    }
  } finally {
    await removeTemporaryCodexHome(tempHomePath, authFilePath)
  }
}

async function removeTemporaryCodexHome(
  tempHomePath: string,
  authFilePath: string,
): Promise<void> {
  try {
    await fs.unlink(authFilePath)
  } catch {
    try {
      await fs.writeFile(authFilePath, '{}', 'utf8')
    } catch {
      // Best effort: avoid leaving token-bearing temp files behind.
    }
  }

  try {
    await fs.rm(tempHomePath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    })
  } catch (error) {
    debugLog(
      `Could not remove temporary Codex home ${tempHomePath}:`,
      error instanceof Error ? error.message : error,
    )
  }
}

function normalizeRateLimitResponse(
  response: unknown,
  nowSeconds: number,
): ProfileRateLimits | null {
  const snapshots = readRateLimitSnapshots(response)

  for (const snapshot of snapshots) {
    const normalized = normalizeRateLimitSnapshot(snapshot, nowSeconds)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function readRateLimitSnapshots(response: unknown): unknown[] {
  if (!isRecord(response)) {
    return []
  }

  const snapshots: unknown[] = []
  const byLimitId = response.rateLimitsByLimitId
  if (isRecord(byLimitId) && CODEX_LIMIT_ID in byLimitId) {
    snapshots.push(byLimitId[CODEX_LIMIT_ID])
  }
  snapshots.push(response.rateLimits)
  return snapshots
}

function normalizeRateLimitSnapshot(
  snapshot: unknown,
  nowSeconds: number,
): ProfileRateLimits | null {
  if (!isRecord(snapshot)) {
    return null
  }

  const windows = [snapshot.primary, snapshot.secondary].filter(
    (value): value is unknown => value !== null && value !== undefined,
  )
  const normalizedWindows = windows
    .map((window) => normalizeRateLimitWindow(window, nowSeconds))
    .filter((value): value is NormalizedRateLimitWindow => value !== null)

  const fiveHourWindow = findWindowByDuration(
    normalizedWindows,
    FIVE_HOUR_WINDOW_MINUTES,
  )
  const weeklyWindow = findWindowByDuration(
    normalizedWindows,
    WEEKLY_WINDOW_MINUTES,
  )

  if (!fiveHourWindow && !weeklyWindow) {
    return null
  }

  return {
    fiveHour: fiveHourWindow?.rateLimit ?? null,
    weekly: weeklyWindow?.rateLimit ?? null,
  }
}

interface NormalizedRateLimitWindow {
  durationMins: number
  rateLimit: ProfileRateLimitWindow
}

function findWindowByDuration(
  windows: NormalizedRateLimitWindow[],
  targetDurationMins: number,
): NormalizedRateLimitWindow | null {
  return (
    windows.find((window) => window.durationMins === targetDurationMins) || null
  )
}

function normalizeRateLimitWindow(
  window: unknown,
  nowSeconds: number,
): NormalizedRateLimitWindow | null {
  if (!isRecord(window)) {
    return null
  }

  const usedPercent = readWindowUsedPercent(window)
  if (usedPercent === null) {
    return null
  }

  const durationMins = readWindowDurationMins(window)
  if (durationMins === null) {
    return null
  }

  const resetsAt = readWindowResetTimestamp(window, nowSeconds)

  return {
    durationMins,
    rateLimit: {
      usedPercent,
      remainingPercent: clampPercent(100 - usedPercent),
      resetsAt,
    },
  }
}

function readWindowUsedPercent(window: Record<string, unknown>): number | null {
  const usedPercent = window.usedPercent ?? window.used_percent
  return typeof usedPercent === 'number' && Number.isFinite(usedPercent)
    ? clampPercent(usedPercent)
    : null
}

function readWindowDurationMins(
  window: Record<string, unknown>,
): number | null {
  const durationMins = window.windowDurationMins ?? window.window_minutes
  return typeof durationMins === 'number' &&
    Number.isFinite(durationMins) &&
    Number.isInteger(durationMins) &&
    durationMins > 0
    ? durationMins
    : null
}

function readWindowResetTimestamp(
  window: Record<string, unknown>,
  nowSeconds: number,
): number | null {
  const resetsAt = window.resetsAt ?? window.resets_at
  if (
    typeof resetsAt === 'number' &&
    isPlausibleUnixTimestampSeconds(resetsAt)
  ) {
    return resetsAt
  }

  const resetsInSeconds = window.resets_in_seconds
  if (
    typeof resetsInSeconds === 'number' &&
    Number.isFinite(resetsInSeconds) &&
    resetsInSeconds >= 0
  ) {
    const resetTimestamp = nowSeconds + Math.floor(resetsInSeconds)
    return isPlausibleUnixTimestampSeconds(resetTimestamp)
      ? resetTimestamp
      : null
  }

  return null
}

function isPlausibleUnixTimestampSeconds(value: number): boolean {
  return Number.isFinite(value) && value >= 946684800 && value <= 4102444800
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

function spawnAppServer(
  env: Record<string, string | undefined>,
): ChildProcessWithoutNullStreams {
  const codexCommand = resolveCodexCliCommand()
  if (!codexCommand) {
    throw new Error(
      'Codex CLI was not found. Configure codexSwitch.codexCliPath or make codex available in PATH.',
    )
  }

  return spawn(codexCommand.command, codexCommand.args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function formatExitReason(code: number | null, signal: string | null): string {
  if (signal) {
    return `signal ${signal}`
  }

  return `code ${code ?? 'unknown'}`
}
