import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import { existsSync } from 'fs'
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
import { debugLog } from '../utils/log'

const RATE_LIMIT_CACHE_TTL_MS = 60 * 1000
const APP_SERVER_REQUEST_TIMEOUT_MS = 8_000
const APP_SERVER_EXIT_TIMEOUT_MS = 2_000
const FIVE_HOUR_WINDOW_MINUTES = 5 * 60
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60
const WINDOWS_CLI_DIRECTORY = 'npm'
const WINDOWS_CLI_FILENAME = 'codex.cmd'
const CODEX_LIMIT_ID = 'codex'

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

interface RateLimitWindowPayload {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

interface RateLimitSnapshotPayload {
  primary: RateLimitWindowPayload | null
  secondary: RateLimitWindowPayload | null
}

interface RateLimitResponsePayload {
  rateLimits: RateLimitSnapshotPayload | null
  rateLimitsByLimitId: Record<string, RateLimitSnapshotPayload | undefined> | null
}

interface CacheEntry {
  profileUpdatedAt: string
  fetchedAt: number
  rateLimits: ProfileRateLimits | null
}

interface DecorateProfilesOptions {
  forceRefresh?: boolean
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

  async readRateLimits(): Promise<RateLimitResponsePayload> {
    return (await this.sendRequest('account/rateLimits/read')) as RateLimitResponsePayload
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

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
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

    let message: JsonRpcSuccessResponse | JsonRpcErrorResponse | { id?: JsonRpcId; method?: string }
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
      pending.reject(new Error('Codex app-server returned an invalid response.'))
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
  private readonly inflight = new Map<string, Promise<ProfileRateLimits | null>>()

  applyCachedRateLimits(profiles: ProfileSummary[]): ProfileSummary[] {
    return profiles.map((profile) => ({
      ...profile,
      rateLimits: this.getFreshCachedRateLimits(profile),
    }))
  }

  async decorateProfiles(
    profileManager: ProfileManager,
    profiles: ProfileSummary[],
    options: DecorateProfilesOptions = {},
  ): Promise<ProfileSummary[]> {
    return await Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        rateLimits: await this.getRateLimits(
          profileManager,
          profile,
          options.forceRefresh === true,
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

  private async getRateLimits(
    profileManager: ProfileManager,
    profile: ProfileSummary,
    forceRefresh = false,
  ): Promise<ProfileRateLimits | null> {
    if (!forceRefresh) {
      const cached = this.getFreshCachedRateLimits(profile)
      if (cached !== undefined) {
        return cached
      }
    }

    const inflightKey = `${profile.id}:${profile.updatedAt}`
    const existing = this.inflight.get(inflightKey)
    if (existing) {
      return await existing
    }

    const promise = this.fetchRateLimits(profileManager, profile)
    this.inflight.set(inflightKey, promise)

    try {
      return await promise
    } finally {
      this.inflight.delete(inflightKey)
    }
  }

  private async fetchRateLimits(
    profileManager: ProfileManager,
    profile: ProfileSummary,
  ): Promise<ProfileRateLimits | null> {
    const authData = await profileManager.loadAuthData(profile.id)
    if (!authData) {
      this.cacheResult(profile, null)
      return null
    }

    try {
      const rateLimits = await queryRateLimitsViaTemporaryCodexHome(authData)
      this.cacheResult(profile, rateLimits)
      return rateLimits
    } catch (error) {
      debugLog(
        `Rate limits unavailable for profile ${profile.id}:`,
        error instanceof Error ? error.message : error,
      )
      this.cacheResult(profile, null)
      return null
    }
  }

  private cacheResult(
    profile: ProfileSummary,
    rateLimits: ProfileRateLimits | null,
  ): void {
    this.cache.set(profile.id, {
      profileUpdatedAt: profile.updatedAt,
      fetchedAt: Date.now(),
      rateLimits,
    })
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
    await fs.writeFile(authFilePath, buildCodexAuthJson(authData), 'utf8')

    const client = new CodexAppServerClient(tempHomePath)
    try {
      await client.initialize()
      const response = await client.readRateLimits()
      return normalizeRateLimitResponse(response)
    } finally {
      await client.dispose()
    }
  } finally {
    await fs.rm(tempHomePath, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    })
  }
}

function normalizeRateLimitResponse(
  response: RateLimitResponsePayload,
): ProfileRateLimits | null {
  const snapshot =
    response.rateLimitsByLimitId?.[CODEX_LIMIT_ID] || response.rateLimits
  if (!snapshot) {
    return null
  }

  const windows = [snapshot.primary, snapshot.secondary].filter(
    (value): value is RateLimitWindowPayload => value !== null,
  )
  const fiveHourWindow = findWindowByDuration(windows, FIVE_HOUR_WINDOW_MINUTES)
  const weeklyWindow = findWindowByDuration(windows, WEEKLY_WINDOW_MINUTES)

  const normalized: ProfileRateLimits = {
    fiveHour: normalizeWindow(fiveHourWindow),
    weekly: normalizeWindow(weeklyWindow),
  }

  if (!normalized.fiveHour && !normalized.weekly) {
    return null
  }

  return normalized
}

function findWindowByDuration(
  windows: RateLimitWindowPayload[],
  targetDurationMins: number,
): RateLimitWindowPayload | null {
  return (
    windows.find((window) => window.windowDurationMins === targetDurationMins) ||
    null
  )
}

function normalizeWindow(
  window: RateLimitWindowPayload | null | undefined,
): ProfileRateLimitWindow | null {
  if (!window || typeof window.usedPercent !== 'number') {
    return null
  }

  const usedPercent = clampPercent(window.usedPercent)
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetsAt: window.resetsAt,
  }
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

function spawnAppServer(
  env: Record<string, string | undefined>,
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    const codexCommand = resolveWindowsCodexCommand()
    return spawn(codexCommand, ['app-server'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    })
  }

  return spawn('codex', ['app-server'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function resolveWindowsCodexCommand(): string {
  const appData = process.env.APPDATA
  if (!appData) {
    return WINDOWS_CLI_FILENAME
  }

  const candidate = path.join(appData, WINDOWS_CLI_DIRECTORY, WINDOWS_CLI_FILENAME)
  return existsSync(candidate) ? candidate : WINDOWS_CLI_FILENAME
}

function formatExitReason(code: number | null, signal: string | null): string {
  if (signal) {
    return `signal ${signal}`
  }

  return `code ${code ?? 'unknown'}`
}