import { randomUUID } from 'crypto'
import { dirname, basename, join } from 'path'
import type { ProfileSummary } from '../types'
import type { ProfileManager } from './profile-manager'
import type { ProfileMaintenanceRunResult } from './profile-rate-limit-service'
import {
  MaintenanceLease,
  type LeaseDiagnostics,
  type LeaseFileSystem,
  type LeaseOwnership,
} from '../utils/profile-maintenance-lease'
import type { MaintenancePaths } from '../utils/profile-maintenance-paths'
import {
  MAINTENANCE_STATE_SCHEMA_VERSION,
  parseMaintenanceProfileState,
  serializeMaintenanceProfileState,
  type MaintenanceProfileState,
} from '../utils/profile-maintenance-state'
import {
  derivePollIntervalSeconds,
  deriveInitialFailureRetrySeconds,
  deriveStartupJitterSeconds,
} from '../utils/refresh-options'

export interface MaintenanceFileSystem extends LeaseFileSystem {
  readFile: (path: string, encoding: 'utf8') => Promise<string>
}

interface RunMaintenance {
  (
    profileManager: ProfileManager,
    profile: ProfileSummary,
  ): Promise<ProfileMaintenanceRunResult>
}

export interface ProfileMaintenanceServiceDeps {
  paths: MaintenancePaths
  diagnostics: LeaseDiagnostics
  fs: MaintenanceFileSystem
  profileManager: ProfileManager
  runProfileMaintenance: RunMaintenance
  getIntervalSeconds: () => number
  now?: () => number
  random?: () => number
  uuid?: () => string
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  debugLog?: (...args: unknown[]) => void
  onStateChanged?: () => void
}

export interface RequestCycleOptions {
  forceProfileIds?: readonly string[]
}

const MIN_POLL_MS = 5_000

/**
 * Coordinates background profile maintenance across all windows of one IDE
 * product. There is no permanent leader: each cycle is owned by whichever
 * window currently holds the store-wide lease. The owner checks every due
 * profile serially, persists rotated auth, and publishes per-profile shared
 * state that other windows read without launching Codex.
 */
export class ProfileMaintenanceService {
  private readonly fs: MaintenanceFileSystem
  private readonly now: () => number
  private readonly random: () => number
  private readonly uuid: () => string
  private readonly setTimer: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  private readonly debugLog: (...args: unknown[]) => void
  private onStateChanged: () => void
  private readonly lease: MaintenanceLease

  private timer: ReturnType<typeof setTimeout> | undefined
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private cyclePromise: Promise<void> | null = null
  private rerunRequested = false
  private pendingForceIds = new Set<string>()
  private activeProfileId: string | undefined

  constructor(private readonly deps: ProfileMaintenanceServiceDeps) {
    this.fs = deps.fs
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.uuid = deps.uuid ?? randomUUID
    this.setTimer = deps.setTimer ?? setTimeout
    this.clearTimer = deps.clearTimer ?? clearTimeout
    this.debugLog = deps.debugLog ?? (() => undefined)
    this.onStateChanged = deps.onStateChanged ?? (() => undefined)
    this.lease = new MaintenanceLease(deps.paths.leaseFile, deps.diagnostics, {
      fs: deps.fs,
      now: this.now,
      uuid: this.uuid,
      debugLog: this.debugLog,
    })
  }

  /** Begin polling after a short startup jitter. Safe to call once. */
  start(): void {
    if (this.disposed) {
      return
    }
    const jitterMs = Math.round(
      deriveStartupJitterSeconds(this.normalizedInterval(), this.random) * 1000,
    )
    this.startupTimer = this.setTimer(() => {
      this.startupTimer = undefined
      void this.requestCycle()
      this.scheduleNextPoll()
    }, jitterMs)
    unrefTimer(this.startupTimer)
  }

  /** Reset polling cadence after a configuration change. */
  reschedule(): void {
    this.clearPollTimer()
    if (!this.disposed) {
      this.scheduleNextPoll()
    }
  }

  /**
   * Request a maintenance cycle now. Only the lease owner launches Codex; other
   * windows observe the lease and return. In-process the cycle is deduplicated,
   * and forced profile ids are merged across overlapping requests.
   */
  async requestCycle(options: RequestCycleOptions = {}): Promise<void> {
    for (const id of options.forceProfileIds ?? []) {
      this.pendingForceIds.add(id)
    }

    if (this.cyclePromise) {
      this.rerunRequested = true
      return this.cyclePromise
    }

    this.cyclePromise = this.runCycleLoop()
    try {
      await this.cyclePromise
    } finally {
      this.cyclePromise = null
    }
  }

  async readProfileState(
    profileId: string,
  ): Promise<MaintenanceProfileState | null> {
    return this.readState(profileId)
  }

  /** Set the listener invoked after each profile result is published. */
  setStateChangedListener(listener: () => void): void {
    this.onStateChanged = listener
  }

  /** The profile this window is currently maintaining, if any (for UI state). */
  getActiveProfileId(): string | undefined {
    return this.activeProfileId
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.clearPollTimer()
    if (this.startupTimer !== undefined) {
      this.clearTimer(this.startupTimer)
      this.startupTimer = undefined
    }
    if (this.cyclePromise) {
      try {
        await this.cyclePromise
      } catch {
        // Disposal must not throw on a failed in-flight cycle.
      }
    }
  }

  private async runCycleLoop(): Promise<void> {
    do {
      this.rerunRequested = false
      const forceIds = new Set(this.pendingForceIds)
      this.pendingForceIds.clear()
      try {
        await this.runCycle(forceIds)
      } catch (error) {
        this.debugLog(
          'Maintenance cycle failed:',
          error instanceof Error ? error.message : error,
        )
      }
    } while (this.rerunRequested && !this.disposed)
  }

  private async runCycle(forceIds: Set<string>): Promise<void> {
    if (this.disposed) {
      return
    }

    const manual = forceIds.size > 0
    const intervalSeconds = this.normalizedInterval()
    if (intervalSeconds <= 0 && !manual) {
      return
    }

    const initialProfiles = await this.deps.profileManager.listProfiles()
    if (!(await this.hasDueWork(initialProfiles, forceIds, manual))) {
      return
    }

    const ownership = await this.lease.tryAcquire({
      status: 'starting',
      profilesTotal: initialProfiles.length,
      profilesCompleted: 0,
    })
    if (!ownership) {
      return
    }

    try {
      // Re-read after acquisition: another owner may have just finished a cycle.
      const profiles = await this.deps.profileManager.listProfiles()
      const queue = await this.buildDueQueue(profiles, forceIds, manual)
      if (queue.length === 0) {
        return
      }

      let completed = 0
      for (const profile of queue) {
        if (this.disposed) {
          break
        }
        const alive = await this.lease.heartbeat(ownership, {
          status: 'refreshing',
          profilesTotal: queue.length,
          profilesCompleted: completed,
        })
        if (!alive || !(await this.lease.stillOwns(ownership))) {
          break
        }

        const handled = await this.maintainProfile(
          profile,
          ownership,
          intervalSeconds,
        )
        if (!handled) {
          break
        }
        completed += 1
      }
    } finally {
      await this.lease.release(ownership)
    }
  }

  private async maintainProfile(
    profile: ProfileSummary,
    ownership: LeaseOwnership,
    intervalSeconds: number,
  ): Promise<boolean> {
    const previous = await this.readState(profile.id)
    this.activeProfileId = profile.id
    let result: ProfileMaintenanceRunResult
    try {
      result = await this.deps.runProfileMaintenance(
        this.deps.profileManager,
        profile,
      )
    } finally {
      this.activeProfileId = undefined
    }

    // Fence: a window that lost ownership must not publish or keep going.
    if (!(await this.lease.stillOwns(ownership))) {
      return false
    }

    // If the profile was deleted mid-cycle, discard its result.
    if (!(await this.profileStillExists(profile.id))) {
      return true
    }

    const nextState = this.computeNextState(previous, result, intervalSeconds)
    await this.writeState(profile.id, nextState)
    this.onStateChanged()
    return true
  }

  private async hasDueWork(
    profiles: ProfileSummary[],
    forceIds: Set<string>,
    manual: boolean,
  ): Promise<boolean> {
    if (manual && profiles.some((profile) => forceIds.has(profile.id))) {
      return true
    }
    const queue = await this.buildDueQueue(profiles, forceIds, manual)
    return queue.length > 0
  }

  private async buildDueQueue(
    profiles: ProfileSummary[],
    forceIds: Set<string>,
    manual: boolean,
  ): Promise<ProfileSummary[]> {
    const now = this.now()
    const entries: Array<{ profile: ProfileSummary; order: number }> = []
    for (const profile of profiles) {
      const state = await this.readState(profile.id)
      const forced = manual && forceIds.has(profile.id)
      if (!forced && !isProfileDue(state, now)) {
        continue
      }
      // Oldest successful refresh first; never-refreshed profiles first.
      const order = state?.lastSuccessAt ?? 0
      entries.push({ profile, order })
    }
    entries.sort((a, b) => a.order - b.order)
    return entries.map((entry) => entry.profile)
  }

  private computeNextState(
    previous: MaintenanceProfileState | null,
    result: ProfileMaintenanceRunResult,
    intervalSeconds: number,
  ): MaintenanceProfileState {
    const now = this.now()
    const generation = (previous?.generation ?? 0) + 1
    const intervalMs = intervalSeconds > 0 ? intervalSeconds * 1000 : null

    if (result.status === 'success') {
      const state: MaintenanceProfileState = {
        schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
        generation,
        status: 'success',
        lastAttemptAt: now,
        lastSuccessAt: now,
        nextDueAt: intervalMs === null ? null : now + intervalMs,
        nextRetryAt: null,
        consecutiveFailures: 0,
      }
      if (result.rateLimits) {
        state.rateLimits = result.rateLimits
      }
      return state
    }

    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1
    const status = result.errorCategory === 'canceled' ? 'canceled' : 'failed'
    const state: MaintenanceProfileState = {
      schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
      generation,
      status,
      lastAttemptAt: now,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      nextDueAt: previous?.nextDueAt ?? null,
      nextRetryAt:
        now + this.computeRetryBackoffMs(consecutiveFailures, intervalSeconds),
      consecutiveFailures,
    }
    if (result.errorCategory) {
      state.errorCategory = result.errorCategory
    }
    // Never erase the last successful usage because the latest attempt failed.
    const retainedRateLimits = result.rateLimits ?? previous?.rateLimits
    if (retainedRateLimits) {
      state.rateLimits = retainedRateLimits
    }
    return state
  }

  private computeRetryBackoffMs(
    consecutiveFailures: number,
    intervalSeconds: number,
  ): number {
    const initial = deriveInitialFailureRetrySeconds(
      intervalSeconds > 0 ? intervalSeconds : 900,
    )
    const maxBackoff = intervalSeconds > 0 ? intervalSeconds : initial
    const exponent = Math.max(0, consecutiveFailures - 1)
    const seconds = Math.min(initial * 2 ** exponent, maxBackoff)
    return Math.round(seconds * 1000)
  }

  private async profileStillExists(profileId: string): Promise<boolean> {
    const profile = await this.deps.profileManager.getProfile(profileId)
    return profile !== undefined
  }

  private normalizedInterval(): number {
    return this.deps.getIntervalSeconds()
  }

  private pollMs(): number {
    const intervalSeconds = this.normalizedInterval()
    const base = intervalSeconds > 0 ? intervalSeconds : 900
    return Math.max(MIN_POLL_MS, derivePollIntervalSeconds(base) * 1000)
  }

  private scheduleNextPoll(): void {
    this.clearPollTimer()
    if (this.disposed) {
      return
    }
    this.timer = this.setTimer(() => {
      void this.requestCycle().finally(() => {
        this.scheduleNextPoll()
      })
    }, this.pollMs())
    unrefTimer(this.timer)
  }

  private clearPollTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer)
      this.timer = undefined
    }
  }

  private async readState(
    profileId: string,
  ): Promise<MaintenanceProfileState | null> {
    let raw: string
    try {
      raw = await this.fs.readFile(
        this.deps.paths.profileStateFile(profileId),
        'utf8',
      )
    } catch {
      return null
    }
    try {
      return parseMaintenanceProfileState(JSON.parse(raw))
    } catch {
      return null
    }
  }

  private async writeState(
    profileId: string,
    state: MaintenanceProfileState,
  ): Promise<void> {
    const target = this.deps.paths.profileStateFile(profileId)
    await this.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const content = `${JSON.stringify(serializeMaintenanceProfileState(state), null, 2)}\n`
    const tmpPath = join(
      dirname(target),
      `${basename(target)}.tmp.${this.uuid()}`,
    )
    await this.fs.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 })
    try {
      await this.fs.rename(tmpPath, target)
    } catch (error) {
      await this.fs.unlink(tmpPath).catch(() => undefined)
      throw error
    }
  }
}

/**
 * Background scheduling must never keep the host (or a test process) from
 * exiting cleanly. The VS Code event loop stays alive on its own, so unref'd
 * timers still fire while the window is open but do not block shutdown.
 */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  ;(handle as { unref?: () => void }).unref?.()
}

/**
 * A profile is due when it has no state, its scheduled refresh time has passed,
 * or a failed attempt's retry time has passed.
 */
export function isProfileDue(
  state: MaintenanceProfileState | null,
  now: number,
): boolean {
  if (!state) {
    return true
  }
  if (state.status === 'success') {
    return state.nextDueAt === null || state.nextDueAt <= now
  }
  return state.nextRetryAt === null || state.nextRetryAt <= now
}
