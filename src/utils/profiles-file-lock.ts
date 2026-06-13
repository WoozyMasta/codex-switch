import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { setTimeout as delay } from 'timers/promises'

const LOCK_RETRY_DELAY_MS = 50
const LOCK_STALE_MS = 30_000

function isEEXIST(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EEXIST'
}

function isStaleLock(lockPath: string): boolean {
  const stat = statSync(lockPath)
  if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
    return true
  }
  return false
}

async function waitForLockRelease(lockPath: string): Promise<void> {
  if (isStaleLock(lockPath)) {
    unlinkSync(lockPath)
    return
  }

  await delay(LOCK_RETRY_DELAY_MS)
}

export async function withProfilesFileLock<T>(
  profilesPath: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = `${profilesPath}.lock`
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  while (true) {
    try {
      writeFileSync(
        lockPath,
        `${JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
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
      await waitForLockRelease(lockPath)
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
