import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { setTimeout as delay } from 'timers/promises'

/** Milliseconds to wait between lock acquisition attempts. */
const LOCK_RETRY_DELAY_MS = 50
/** Lock file age in milliseconds before considering it stale. */
const LOCK_STALE_MS = 30_000

/** Optional dependencies for lock file timing. */
interface ProfilesFileLockDeps {
  /** Optional current time function (defaults to Date.now). */
  now?: () => number
}

/** Checks if an error is an EEXIST file already exists error. */
function isEEXIST(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EEXIST'
}

/** Determines if a lock file is stale (older than threshold). */
function isStaleLock(lockPath: string, now: () => number): boolean {
  const stat = statSync(lockPath)
  if (now() - stat.mtimeMs > LOCK_STALE_MS) {
    return true
  }
  return false
}

/** Waits for lock release by checking staleness or yielding control. */
async function waitForLockRelease(
  lockPath: string,
  now: () => number,
): Promise<void> {
  if (isStaleLock(lockPath, now)) {
    unlinkSync(lockPath)
    return
  }

  await delay(LOCK_RETRY_DELAY_MS)
}

/** Acquires a lock on the profiles file and executes an action, releasing the lock afterward. */
export async function withProfilesFileLock<T>(
  profilesPath: string,
  action: () => Promise<T>,
  deps: ProfilesFileLockDeps = {},
): Promise<T> {
  const now = deps.now ?? Date.now
  const lockPath = `${profilesPath}.lock`
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  while (true) {
    try {
      writeFileSync(
        lockPath,
        `${JSON.stringify({
          pid: process.pid,
          createdAt: new Date(now()).toISOString(),
        })}\n`,
        {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        },
      )
      break
    } catch (error) {
      if (!isEEXIST(error)) {
        throw error
      }
      await waitForLockRelease(lockPath, now)
    }
  }

  try {
    return await action()
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {
      // Ignore cleanup failures.
    }
  }
}
