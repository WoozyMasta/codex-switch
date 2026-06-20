import { randomUUID } from 'crypto'
import { dirname, basename, join } from 'path'

export const MAINTENANCE_LEASE_SCHEMA_VERSION = 1
export const MAINTENANCE_LEASE_STALE_MS = 60_000

/**
 * Minimal async filesystem surface the lease needs. `fs/promises` satisfies it;
 * tests can inject a fake to simulate races and crashes.
 */
export interface LeaseFileSystem {
  mkdir: (
    path: string,
    options: { recursive: boolean; mode?: number },
  ) => Promise<unknown>
  writeFile: (
    path: string,
    data: string,
    options: { encoding: 'utf8'; mode?: number; flag?: string },
  ) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  rename: (oldPath: string, newPath: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

/** Non-sensitive diagnostics recorded inside the lease for debugging only. */
export interface LeaseDiagnostics {
  pid: number
  sessionId: string
  appName: string
  uriScheme: string
  ideVersion: string
  extensionVersion: string
}

export interface LeaseProgress {
  status: string
  profilesTotal: number
  profilesCompleted: number
}

export interface LeaseOwnership {
  leaseId: string
  startedAt: number
}

interface LeaseFileContent {
  schemaVersion: number
  leaseId: string
  pid: number
  sessionId: string
  appName: string
  uriScheme: string
  ideVersion: string
  extensionVersion: string
  startedAt: number
  heartbeatAt: number
  status: string
  profilesTotal: number
  profilesCompleted: number
}

interface MaintenanceLeaseDeps {
  fs: LeaseFileSystem
  now?: () => number
  uuid?: () => string
  staleMs?: number
  debugLog?: (...args: unknown[]) => void
}

function isErrnoException(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === code
  )
}

/**
 * A store-wide maintenance lease backed by an atomic exclusive file create.
 *
 * There is no permanent leader: any window may acquire the lease for one
 * complete cycle, then release it. A crashed owner leaves a stale lease that
 * another window recovers after the heartbeat threshold. Every shared-state
 * write must be guarded by an ownership (fencing) check first.
 */
export class MaintenanceLease {
  private readonly fs: LeaseFileSystem
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly staleMs: number
  private readonly debugLog: (...args: unknown[]) => void

  constructor(
    private readonly leaseFile: string,
    private readonly diagnostics: LeaseDiagnostics,
    deps: MaintenanceLeaseDeps,
  ) {
    this.fs = deps.fs
    this.now = deps.now ?? Date.now
    this.uuid = deps.uuid ?? randomUUID
    this.staleMs = deps.staleMs ?? MAINTENANCE_LEASE_STALE_MS
    this.debugLog = deps.debugLog ?? (() => undefined)
  }

  /**
   * Attempt to acquire the lease. Returns ownership on success or null when a
   * fresh lease is already held by another window.
   */
  async tryAcquire(progress: LeaseProgress): Promise<LeaseOwnership | null> {
    await this.ensureDir()

    const direct = await this.tryExclusiveCreate(progress)
    if (direct) {
      return direct
    }

    // A lease file already exists. Recover it only if it is stale.
    const existing = await this.readLease()
    if (existing && !this.isStale(existing)) {
      return null
    }

    return await this.tryStaleTakeover(progress)
  }

  /**
   * Refresh the heartbeat and progress. Returns false when ownership was lost
   * (another window took over); the caller must then stop and discard results.
   */
  async heartbeat(
    ownership: LeaseOwnership,
    progress: LeaseProgress,
  ): Promise<boolean> {
    if (!(await this.stillOwns(ownership))) {
      return false
    }

    try {
      await this.atomicWrite(this.buildContent(ownership, progress))
      return true
    } catch (error) {
      this.debugLog(
        'Maintenance lease heartbeat write failed:',
        error instanceof Error ? error.message : error,
      )
      return true
    }
  }

  /**
   * Fencing check: confirm the on-disk leaseId still matches this owner. A
   * process that lost ownership must not publish results or write credentials.
   */
  async stillOwns(ownership: LeaseOwnership): Promise<boolean> {
    const existing = await this.readLease()
    return existing?.leaseId === ownership.leaseId
  }

  /** Release the lease, but never remove a replacement created by another process. */
  async release(ownership: LeaseOwnership): Promise<void> {
    if (!(await this.stillOwns(ownership))) {
      return
    }
    try {
      await this.fs.unlink(this.leaseFile)
    } catch (error) {
      this.debugLog(
        'Maintenance lease release failed:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  private async ensureDir(): Promise<void> {
    await this.fs.mkdir(dirname(this.leaseFile), {
      recursive: true,
      mode: 0o700,
    })
  }

  private async tryExclusiveCreate(
    progress: LeaseProgress,
  ): Promise<LeaseOwnership | null> {
    const ownership: LeaseOwnership = {
      leaseId: this.uuid(),
      startedAt: this.now(),
    }
    try {
      await this.fs.writeFile(
        this.leaseFile,
        this.serialize(this.buildContent(ownership, progress)),
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      )
      return ownership
    } catch (error) {
      if (isErrnoException(error, 'EEXIST')) {
        return null
      }
      throw error
    }
  }

  private async tryStaleTakeover(
    progress: LeaseProgress,
  ): Promise<LeaseOwnership | null> {
    // Rename the stale lease to a unique name first. Only the process that
    // wins the rename + exclusive create becomes the owner; a direct unlink
    // would let two contenders both observe the same stale file and proceed.
    const stalePath = join(
      dirname(this.leaseFile),
      `${basename(this.leaseFile)}.stale.${this.uuid()}`,
    )
    try {
      await this.fs.rename(this.leaseFile, stalePath)
    } catch (error) {
      this.debugLog(
        'Maintenance lease stale rename lost the race:',
        error instanceof Error ? error.message : error,
      )
      return null
    }

    const ownership = await this.tryExclusiveCreate(progress)
    await this.bestEffortUnlink(stalePath)
    return ownership
  }

  private async bestEffortUnlink(path: string): Promise<void> {
    try {
      await this.fs.unlink(path)
    } catch {
      // Best-effort cleanup of the renamed stale lease.
    }
  }

  private async readLease(): Promise<LeaseFileContent | null> {
    let raw: string
    try {
      raw = await this.fs.readFile(this.leaseFile, 'utf8')
    } catch {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // JSON numbers are always finite, so a numeric heartbeat is sufficient.
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.leaseId !== 'string' ||
        typeof parsed.heartbeatAt !== 'number'
      ) {
        return null
      }
      return parsed as unknown as LeaseFileContent
    } catch {
      return null
    }
  }

  private isStale(content: LeaseFileContent): boolean {
    return this.now() - content.heartbeatAt >= this.staleMs
  }

  private buildContent(
    ownership: LeaseOwnership,
    progress: LeaseProgress,
  ): LeaseFileContent {
    return {
      schemaVersion: MAINTENANCE_LEASE_SCHEMA_VERSION,
      leaseId: ownership.leaseId,
      pid: this.diagnostics.pid,
      sessionId: this.diagnostics.sessionId,
      appName: this.diagnostics.appName,
      uriScheme: this.diagnostics.uriScheme,
      ideVersion: this.diagnostics.ideVersion,
      extensionVersion: this.diagnostics.extensionVersion,
      startedAt: ownership.startedAt,
      heartbeatAt: this.now(),
      status: progress.status,
      profilesTotal: progress.profilesTotal,
      profilesCompleted: progress.profilesCompleted,
    }
  }

  private serialize(content: LeaseFileContent): string {
    return `${JSON.stringify(content, null, 2)}\n`
  }

  private async atomicWrite(content: LeaseFileContent): Promise<void> {
    const tmpPath = join(
      dirname(this.leaseFile),
      `${basename(this.leaseFile)}.tmp.${this.uuid()}`,
    )
    await this.fs.writeFile(tmpPath, this.serialize(content), {
      encoding: 'utf8',
      mode: 0o600,
    })
    try {
      await this.fs.rename(tmpPath, this.leaseFile)
    } catch (error) {
      await this.bestEffortUnlink(tmpPath)
      throw error
    }
  }
}
