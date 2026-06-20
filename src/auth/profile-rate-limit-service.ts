import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { buildCodexAuthJson } from './codex-auth-sync'
import { extractAuthDataFromAuthJson } from './auth-manager'
import type { ProfileManager } from './profile-manager'
import type { AuthData, ProfileRateLimits, ProfileSummary } from '../types'
import type { CodexCliCommand } from '../utils/codex-cli-resolver'
import { normalizeRateLimitResponse } from '../utils/rate-limit-normalizer'
import { getCanonicalTokenBundle } from '../utils/auth-payload'
import { getAuthLastRefresh } from '../utils/auth-refresh-policy'
import type { ProfileRefreshStatus } from '../utils/profile-refresh-status'
import type { MaintenanceErrorCategory } from '../utils/profile-maintenance-state'
import type {
  AsyncFileSystem,
  Clock,
  ProcessEnv,
  SpawnAppServer,
} from './runtime-adapters'

const RATE_LIMIT_CACHE_TTL_MS = 60 * 1000
const APP_SERVER_REQUEST_TIMEOUT_MS = 5_000
const APP_SERVER_EXIT_TIMEOUT_MS = 2_000
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
  lastSuccessAt?: number
  lastFailureAt?: number
}

/**
 * Both outputs of a single temporary-home maintenance request:
 * the normalized rate limits and any auth Codex refreshed in the temp home.
 * `refreshedAuth` is kept only in memory and is never persisted to
 * coordination state.
 */
interface ProfileMaintenanceResult {
  rateLimits: ProfileRateLimits | null
  refreshedAuth: AuthData | null
}

/**
 * Structured outcome of one serial maintenance pass over a single profile,
 * used by the cross-window scheduler to publish shared state.
 */
export interface ProfileMaintenanceRunResult {
  status: 'success' | 'failed'
  rateLimits: ProfileRateLimits | null
  errorCategory?: MaintenanceErrorCategory
}

interface DecorateProfilesOptions {
  forceRefresh?: boolean
  forceRefreshProfileIds?: readonly string[]
}

interface ProfileRateLimitServiceDeps {
  env?: ProcessEnv
  now?: Clock
  tmpdir?: () => string
  resolveCodexCliCommand?: () => CodexCliCommand | null
  debugLog?: (...args: unknown[]) => void
  spawnAppServer?: SpawnAppServer
  tempHomeFs?: AsyncFileSystem
}

interface AppServerWaiter {
  resolve: () => void
  reject: (error: Error) => void
  onAbort: () => void
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lineReader: readline.Interface
  private readonly clientVersion: string
  private readonly codexCliCommand: CodexCliCommand
  private readonly debugLog: (...args: unknown[]) => void
  private readonly spawnAppServer: SpawnAppServer
  private readonly onStdoutLine = (line: string) => {
    this.handleLine(line)
  }
  private readonly onChildError = (error: Error) => {
    this.handleChildError(error)
  }
  private readonly onChildExit = (
    code: number | null,
    signal: string | null,
  ) => {
    this.handleChildExit(code, signal)
  }
  private readonly onStderrData = (chunk: string) => {
    this.handleStderrData(chunk)
  }
  private readonly onStdinError = (error: Error) => {
    this.handleStdinError(error)
  }
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
  private disposing = false
  private disposed = false

  constructor(
    codexHomePath: string,
    clientVersion: string,
    codexCliCommand: CodexCliCommand,
    debugLog: (...args: unknown[]) => void,
    env: ProcessEnv = process.env,
    spawnAppServer: SpawnAppServer = spawnCodexAppServer,
  ) {
    this.clientVersion = clientVersion
    this.codexCliCommand = codexCliCommand
    this.debugLog = debugLog
    this.spawnAppServer = spawnAppServer
    const childEnv = {
      ...env,
      CODEX_HOME: codexHomePath,
    }

    this.child = this.spawnAppServer(this.codexCliCommand, childEnv)
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', this.onStderrData)
    this.child.stdin.on('error', this.onStdinError)

    this.lineReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })
    this.lineReader.on('line', this.onStdoutLine)

    this.child.on('error', this.onChildError)
    this.child.on('exit', this.onChildExit)
  }

  async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'codex-switch',
        title: null,
        version: this.clientVersion,
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
    if (this.disposed || this.disposing) {
      return
    }

    this.disposing = true
    this.rejectAllPending(new Error('Codex app-server request was canceled.'))

    try {
      await this.sendLifecycleRequest('shutdown').catch((error) => {
        this.debugLog(
          'Codex app-server shutdown request failed:',
          error instanceof Error ? error.message : error,
        )
      })
    } finally {
      await this.sendLifecycleNotification('exit').catch((error) => {
        this.debugLog(
          'Codex app-server exit notification failed:',
          error instanceof Error ? error.message : error,
        )
      })
      this.child.stdin.end()
      await this.terminateChild()
      this.lineReader.close()
      this.removeListeners()
      this.disposed = true
      this.disposing = false
    }
  }

  private removeListeners(): void {
    this.lineReader.off('line', this.onStdoutLine)
    this.child.off('error', this.onChildError)
    this.child.off('exit', this.onChildExit)
    this.child.stdin.off('error', this.onStdinError)
    this.child.stderr.off('data', this.onStderrData)
  }

  private async terminateChild(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return
    }

    this.child.kill()
    if (await this.waitForExit(APP_SERVER_EXIT_TIMEOUT_MS)) {
      return
    }

    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return
    }

    this.child.kill('SIGKILL')
    await this.waitForExit(APP_SERVER_EXIT_TIMEOUT_MS)
  }

  private async sendRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    if (this.disposing || this.disposed) {
      throw new Error('Codex app-server client is closing.')
    }

    return await this.sendRequestInternal(method, params)
  }

  private async sendLifecycleRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    return await this.sendRequestInternal(method, params)
  }

  private async sendLifecycleNotification(
    method: string,
    params?: unknown,
  ): Promise<void> {
    await this.writeJsonRpcMessage({
      method,
      ...(params !== undefined ? { params } : {}),
    })
  }

  private async sendRequestInternal(
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

      void this.writeJsonRpcMessage(payload).catch((error) => {
        if (this.pendingRequests.has(id)) {
          this.rejectAllPending(
            new Error(
              `Failed to send Codex app-server request to ${method}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        }
      })
    })
  }

  private async writeJsonRpcMessage(
    message: Record<string, unknown>,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const done = (error?: Error | null) => {
        if (settled) {
          return
        }
        settled = true
        if (error) {
          reject(error)
          return
        }
        resolve()
      }

      try {
        this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) {
            done(error)
            return
          }
          done()
        })
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)))
      }
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
      this.debugLog('Ignoring non-JSON stdout from Codex app-server:', error)
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

  private handleChildError(error: Error): void {
    this.rejectAllPending(
      new Error(`Failed to start Codex app-server: ${error.message}`),
    )
  }

  private handleChildExit(code: number | null, signal: string | null): void {
    this.rejectAllPending(
      new Error(
        `Codex app-server exited before completing the request (${formatExitReason(code, signal)}).${this.getStderrSuffix()}`,
      ),
    )
  }

  private handleStdinError(error: Error): void {
    this.rejectAllPending(
      new Error(
        `Codex app-server stdin write failed: ${error.message || String(error)}`,
      ),
    )
  }

  private handleStderrData(chunk: string): void {
    if (this.stderrChunks.length >= 10) {
      this.stderrChunks.shift()
    }
    this.stderrChunks.push(chunk.trim())
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

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return true
    }

    return await new Promise<boolean>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = undefined
        }
        this.child.removeListener('exit', onExit)
      }
      const onExit = () => {
        cleanup()
        resolve(true)
      }

      timeout = setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeoutMs)

      this.child.once('exit', onExit)
    })
  }

  private getStderrSuffix(): string {
    const stderr = this.stderrChunks.filter(Boolean).join(' ')
    return stderr ? ` Stderr: ${stderr}` : ''
  }
}

export class ProfileRateLimitService {
  private readonly clientVersion: string
  private readonly env: ProcessEnv
  private readonly now: Clock
  private readonly tmpdir: () => string
  private readonly resolveCodexCliCommand: () => CodexCliCommand | null
  private readonly debugLog: (...args: unknown[]) => void
  private readonly spawnAppServer: SpawnAppServer
  private readonly tempHomeFs: AsyncFileSystem
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<
    string,
    Promise<ProfileRateLimits | null>
  >()
  private readonly activeOperationControllers = new Set<AbortController>()
  private readonly activeOperations = new Set<
    Promise<ProfileRateLimits | null>
  >()
  private readonly appServerConcurrencyLimit = 2
  private appServerActiveCount = 0
  private readonly appServerWaitQueue: AppServerWaiter[] = []
  private disposed = false

  constructor(clientVersion: string, deps: ProfileRateLimitServiceDeps = {}) {
    this.clientVersion = clientVersion
    this.env = deps.env ?? process.env
    this.now = deps.now ?? Date.now
    this.tmpdir = deps.tmpdir ?? os.tmpdir
    this.resolveCodexCliCommand = deps.resolveCodexCliCommand ?? (() => null)
    this.debugLog = deps.debugLog ?? (() => undefined)
    this.spawnAppServer = deps.spawnAppServer ?? spawnCodexAppServer
    this.tempHomeFs = deps.tempHomeFs ?? fs
  }

  applyCachedRateLimits(profiles: ProfileSummary[]): ProfileSummary[] {
    return profiles.map((profile) => ({
      ...profile,
      rateLimits: this.getCachedRateLimits(profile),
    }))
  }

  cancelPendingWork(): void {
    for (const controller of this.activeOperationControllers) {
      controller.abort()
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.cancelPendingWork()

    await Promise.allSettled(this.activeOperations)
    this.inflight.clear()
    this.cache.clear()
    this.activeOperationControllers.clear()
    this.appServerWaitQueue.length = 0
  }

  async decorateProfiles(
    profileManager: ProfileManager,
    profiles: ProfileSummary[],
    options: DecorateProfilesOptions = {},
  ): Promise<ProfileSummary[]> {
    const codexCliCommand = this.resolveCodexCliCommand()
    const forceRefreshIds = new Set(options.forceRefreshProfileIds || [])

    return await Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        rateLimits: await this.getRateLimits(
          profileManager,
          profile,
          codexCliCommand,
          options.forceRefresh === true || forceRefreshIds.has(profile.id),
        ),
      })),
    )
  }

  /**
   * Run one maintenance pass for a single profile and return a structured
   * outcome. The cross-window scheduler calls this serially under a lease; it
   * performs the temporary-home request, persists any rotated auth, and updates
   * the in-memory cache so the UI reflects the latest result.
   */
  async runProfileMaintenance(
    profileManager: ProfileManager,
    profile: ProfileSummary,
  ): Promise<ProfileMaintenanceRunResult> {
    if (this.disposed) {
      return {
        status: 'failed',
        rateLimits: this.getCachedRateLimits(profile) ?? null,
        errorCategory: 'canceled',
      }
    }

    const codexCliCommand = this.resolveCodexCliCommand()
    if (!codexCliCommand) {
      return {
        status: 'failed',
        rateLimits: this.getCachedRateLimits(profile) ?? null,
        errorCategory: 'cli-not-found',
      }
    }

    const authData = await profileManager.loadAuthData(profile.id)
    if (!authData) {
      this.cacheFailure(profile)
      return {
        status: 'failed',
        rateLimits: this.getCachedRateLimits(profile) ?? null,
        errorCategory: 'auth-missing',
      }
    }

    const operationController = new AbortController()
    this.activeOperationControllers.add(operationController)
    try {
      const result = await this.runWithAppServerConcurrencyLimit(
        () =>
          queryRateLimitsViaTemporaryCodexHome(
            authData,
            this.clientVersion,
            codexCliCommand,
            operationController.signal,
            this.now,
            this.tmpdir,
            this.debugLog,
            this.env,
            this.spawnAppServer,
            this.tempHomeFs,
          ),
        operationController.signal,
      )

      const { summary, persistFailed } =
        await this.persistRefreshedAuthIfChanged(
          profileManager,
          profile,
          authData,
          result.refreshedAuth,
        )
      this.cacheSuccess(summary, result.rateLimits)

      if (persistFailed) {
        return {
          status: 'failed',
          rateLimits: result.rateLimits,
          errorCategory: 'storage-write-failed',
        }
      }
      return { status: 'success', rateLimits: result.rateLimits }
    } catch (error) {
      if (isAbortError(error) || operationController.signal.aborted) {
        return {
          status: 'failed',
          rateLimits: this.getCachedRateLimits(profile) ?? null,
          errorCategory: 'canceled',
        }
      }
      this.debugLog(
        `Maintenance failed for profile ${profile.id}:`,
        error instanceof Error ? error.message : error,
      )
      this.cacheFailure(profile)
      return {
        status: 'failed',
        rateLimits: this.getCachedRateLimits(profile) ?? null,
        errorCategory: categorizeMaintenanceError(error),
      }
    } finally {
      this.activeOperationControllers.delete(operationController)
    }
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
    codexCliCommand: CodexCliCommand | null,
    forceRefresh = false,
  ): Promise<ProfileRateLimits | null> {
    if (this.disposed) {
      return this.getCachedRateLimits(profile) ?? null
    }

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

    const operationController = new AbortController()
    this.activeOperationControllers.add(operationController)
    const promise = this.fetchRateLimits(
      profileManager,
      profile,
      codexCliCommand,
      operationController.signal,
    )
    this.activeOperations.add(promise)
    this.inflight.set(profile.id, promise)

    try {
      return await promise
    } finally {
      this.inflight.delete(profile.id)
      this.activeOperations.delete(promise)
      this.activeOperationControllers.delete(operationController)
    }
  }

  private async fetchRateLimits(
    profileManager: ProfileManager,
    profile: ProfileSummary,
    codexCliCommand: CodexCliCommand | null,
    signal: AbortSignal,
  ): Promise<ProfileRateLimits | null> {
    if (signal.aborted) {
      return this.getCachedRateLimits(profile) ?? null
    }

    const authData = await profileManager.loadAuthData(profile.id)
    if (!authData) {
      this.cacheFailure(profile)
      return null
    }

    try {
      if (!codexCliCommand) {
        return this.getCachedRateLimits(profile) ?? null
      }

      const result = await this.runWithAppServerConcurrencyLimit(
        () =>
          queryRateLimitsViaTemporaryCodexHome(
            authData,
            this.clientVersion,
            codexCliCommand,
            signal,
            this.now,
            this.tmpdir,
            this.debugLog,
            this.env,
            this.spawnAppServer,
            this.tempHomeFs,
          ),
        signal,
      )

      const { summary } = await this.persistRefreshedAuthIfChanged(
        profileManager,
        profile,
        authData,
        result.refreshedAuth,
      )
      this.cacheSuccess(summary, result.rateLimits)
      return result.rateLimits
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return this.getCachedRateLimits(profile) ?? null
      }
      this.debugLog(
        `Rate limits unavailable for profile ${profile.id}:`,
        error instanceof Error ? error.message : error,
      )
      this.cacheFailure(profile)
      return null
    }
  }

  /**
   * Persist auth that Codex refreshed inside the temporary home back into the
   * saved profile, then return the profile summary whose `updatedAt` the
   * rate-limit cache should key on. When nothing changed (the common path) the
   * original summary is returned without touching storage. `persistFailed`
   * signals that a refresh was available but could not be written, so callers
   * can record a retryable failure instead of a clean success.
   */
  private async persistRefreshedAuthIfChanged(
    profileManager: ProfileManager,
    profile: ProfileSummary,
    baselineAuth: AuthData,
    refreshedAuth: AuthData | null,
  ): Promise<{ summary: ProfileSummary; persistFailed: boolean }> {
    if (!refreshedAuth || !authChangedInMemory(baselineAuth, refreshedAuth)) {
      return { summary: profile, persistFailed: false }
    }

    try {
      const outcome = await profileManager.replaceProfileAuthIfFresher(
        profile.id,
        refreshedAuth,
        baselineAuth,
      )
      if (outcome === 'failed') {
        return { summary: profile, persistFailed: true }
      }
      if (outcome !== 'updated') {
        return { summary: profile, persistFailed: false }
      }

      const updated = await profileManager.getProfile(profile.id)
      return { summary: updated ?? profile, persistFailed: false }
    } catch (error) {
      this.debugLog(
        `Could not persist refreshed auth for profile ${profile.id}:`,
        error instanceof Error ? error.message : error,
      )
      return { summary: profile, persistFailed: true }
    }
  }

  private async runWithAppServerConcurrencyLimit<T>(
    task: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    await this.acquireAppServerSlot(signal)
    try {
      return await task()
    } finally {
      this.releaseAppServerSlot()
    }
  }

  private async acquireAppServerSlot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw createAbortError()
    }

    if (this.appServerActiveCount < this.appServerConcurrencyLimit) {
      this.appServerActiveCount += 1
      return
    }

    await new Promise<void>((resolve, reject) => {
      let waiter: AppServerWaiter
      const settle = (callback: () => void) => {
        signal.removeEventListener('abort', waiter.onAbort)
        callback()
      }
      waiter = {
        resolve: () => settle(resolve),
        reject: (error: Error) => settle(() => reject(error)),
        onAbort: () => {
          const index = this.appServerWaitQueue.indexOf(waiter)
          if (index >= 0) {
            this.appServerWaitQueue.splice(index, 1)
          }
          reject(createAbortError())
        },
      }
      this.appServerWaitQueue.push(waiter)
      signal.addEventListener('abort', waiter.onAbort, { once: true })
    })
    this.appServerActiveCount += 1
  }

  private releaseAppServerSlot(): void {
    this.appServerActiveCount = Math.max(this.appServerActiveCount - 1, 0)
    const next = this.appServerWaitQueue.shift()
    if (next) {
      next.resolve()
    }
  }

  private cacheSuccess(
    profile: ProfileSummary,
    rateLimits: ProfileRateLimits | null,
  ): void {
    const now = this.now()
    this.cache.set(profile.id, {
      profileUpdatedAt: profile.updatedAt,
      fetchedAt: now,
      rateLimits,
      lastSuccessAt: now,
    })
  }

  /**
   * Scheduling status derived from the in-memory cache for UI rendering. The
   * computation is read-only and keys on the profile revision so a stale entry
   * is ignored after auth changes. `intervalSeconds` is the normalized user
   * interval; `0` means automatic refresh is disabled.
   */
  getRefreshStatus(
    profile: ProfileSummary,
    intervalSeconds: number,
  ): ProfileRefreshStatus {
    const isRefreshing = this.inflight.has(profile.id)
    const entry = this.cache.get(profile.id)
    if (!entry || entry.profileUpdatedAt !== profile.updatedAt) {
      return { isRefreshing }
    }

    const lastSuccessAt = entry.lastSuccessAt
    const nextDueAt =
      lastSuccessAt !== undefined && intervalSeconds > 0
        ? lastSuccessAt + intervalSeconds * 1000
        : undefined

    const failed =
      entry.lastFailureAt !== undefined &&
      (lastSuccessAt === undefined || entry.lastFailureAt > lastSuccessAt)
    const nextRetryAt =
      failed && entry.lastFailureAt !== undefined
        ? entry.lastFailureAt + RATE_LIMIT_FAILURE_BACKOFF_MS
        : undefined

    return { lastSuccessAt, nextDueAt, nextRetryAt, isRefreshing }
  }

  private cacheFailure(profile: ProfileSummary): void {
    const existing = this.cache.get(profile.id)
    if (existing && existing.profileUpdatedAt === profile.updatedAt) {
      this.cache.set(profile.id, {
        ...existing,
        lastFailureAt: this.now(),
      })
      return
    }

    this.cache.set(profile.id, {
      profileUpdatedAt: profile.updatedAt,
      fetchedAt: this.now(),
      rateLimits: null,
      lastFailureAt: this.now(),
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

    return this.now() - entry.lastFailureAt < RATE_LIMIT_FAILURE_BACKOFF_MS
  }

  private isFresh(profile: ProfileSummary, entry: CacheEntry): boolean {
    return (
      entry.profileUpdatedAt === profile.updatedAt &&
      this.now() - entry.fetchedAt < RATE_LIMIT_CACHE_TTL_MS
    )
  }
}

async function queryRateLimitsViaTemporaryCodexHome(
  authData: AuthData,
  clientVersion: string,
  codexCliCommand: CodexCliCommand,
  signal?: AbortSignal,
  now: Clock = Date.now,
  tmpdir: () => string = os.tmpdir,
  debugLog: (...args: unknown[]) => void = () => undefined,
  env: ProcessEnv = process.env,
  spawnAppServer: SpawnAppServer = spawnCodexAppServer,
  tempHomeFs: AsyncFileSystem = fs,
): Promise<ProfileMaintenanceResult> {
  if (signal?.aborted) {
    return { rateLimits: null, refreshedAuth: null }
  }

  const tempHomePath = await tempHomeFs.mkdtemp(
    path.join(tmpdir(), 'codex-switch-rate-limits-'),
  )
  const authFilePath = path.join(tempHomePath, 'auth.json')
  let client: CodexAppServerClient | undefined
  const onAbort = () => {
    void client?.dispose()
  }

  try {
    signal?.addEventListener('abort', onAbort, { once: true })
    await tempHomeFs.chmod(tempHomePath, 0o700).catch(() => undefined)
    await tempHomeFs.writeFile(authFilePath, buildCodexAuthJson(authData), {
      encoding: 'utf8',
      mode: 0o600,
    })

    client = new CodexAppServerClient(
      tempHomePath,
      clientVersion,
      codexCliCommand,
      debugLog,
      env,
      spawnAppServer,
    )
    let rateLimits: ProfileRateLimits | null = null
    try {
      await client.initialize()
      const response = await client.readRateLimits()
      rateLimits = normalizeRateLimitResponse(
        response,
        Math.floor(now() / 1000),
      )
    } finally {
      await client.dispose()
    }

    // Codex may rewrite auth.json with rotated tokens while handling the
    // request or during shutdown. Read it after the client is fully disposed,
    // before the temporary home is removed. Kept in memory only.
    const refreshedAuth = await readRefreshedAuthFromTempHome(
      authFilePath,
      tempHomeFs,
      debugLog,
    )
    return { rateLimits, refreshedAuth }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await removeTemporaryCodexHome(
      tempHomePath,
      authFilePath,
      debugLog,
      tempHomeFs,
    )
  }
}

async function readRefreshedAuthFromTempHome(
  authFilePath: string,
  tempHomeFs: AsyncFileSystem,
  debugLog: (...args: unknown[]) => void = () => undefined,
): Promise<AuthData | null> {
  try {
    const content = await tempHomeFs.readFile(authFilePath, 'utf8')
    const authJson = JSON.parse(content) as unknown
    const extracted = extractAuthDataFromAuthJson(authJson)
    if (
      !extracted ||
      !extracted.idToken ||
      !extracted.accessToken ||
      !extracted.refreshToken
    ) {
      return null
    }

    return {
      idToken: extracted.idToken,
      accessToken: extracted.accessToken,
      refreshToken: extracted.refreshToken,
      accountId: extracted.accountId,
      defaultOrganizationId: extracted.defaultOrganizationId,
      defaultOrganizationTitle: extracted.defaultOrganizationTitle,
      chatgptUserId: extracted.chatgptUserId,
      userId: extracted.userId,
      subject: extracted.subject,
      email: extracted.email || 'Unknown',
      planType: extracted.planType || 'Unknown',
      authJson: extracted.authJson,
    }
  } catch (error) {
    debugLog(
      'Could not read refreshed temporary auth:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * In-memory comparison of the baseline auth written into the temp home and the
 * auth read back afterwards. Returns true only when canonical tokens or
 * `last_refresh` changed, so the common no-rotation path never touches storage.
 */
function authChangedInMemory(baseline: AuthData, refreshed: AuthData): boolean {
  const baselineTokens = getCanonicalTokenBundle(baseline)
  const refreshedTokens = getCanonicalTokenBundle(refreshed)
  if (!refreshedTokens) {
    return false
  }
  if (
    !baselineTokens ||
    baselineTokens.idToken !== refreshedTokens.idToken ||
    baselineTokens.accessToken !== refreshedTokens.accessToken ||
    baselineTokens.refreshToken !== refreshedTokens.refreshToken
  ) {
    return true
  }

  return getAuthLastRefresh(baseline) !== getAuthLastRefresh(refreshed)
}

async function removeTemporaryCodexHome(
  tempHomePath: string,
  authFilePath: string,
  debugLog: (...args: unknown[]) => void = () => undefined,
  tempHomeFs: AsyncFileSystem = fs,
): Promise<void> {
  try {
    await tempHomeFs.unlink(authFilePath)
  } catch {
    try {
      await tempHomeFs.writeFile(authFilePath, '{}', 'utf8')
    } catch {
      // Best effort: avoid leaving token-bearing temp files behind.
    }
  }

  try {
    await tempHomeFs.rm(tempHomePath, {
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

function categorizeMaintenanceError(error: unknown): MaintenanceErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  if (/Timed out waiting/i.test(message)) {
    return 'request-timeout'
  }
  if (/invalid response/i.test(message)) {
    return 'response-invalid'
  }
  if (
    /Failed to start|exited before completing|stdin write failed|client is closing/i.test(
      message,
    )
  ) {
    return 'process-failed'
  }
  return 'unknown'
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.message === 'Codex app-server request was canceled.')
  )
}

function createAbortError(): Error {
  const error = new Error('Codex app-server request was canceled.')
  error.name = 'AbortError'
  return error
}

function spawnCodexAppServer(
  codexCommand: CodexCliCommand,
  env: Record<string, string | undefined>,
): ChildProcessWithoutNullStreams {
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
