/* eslint-disable @typescript-eslint/no-require-imports */
import fs = require('fs')
import os = require('os')
import path = require('path')
/* eslint-enable @typescript-eslint/no-require-imports */
import { randomUUID } from 'crypto'

/** Root directory name in user home for shared profile storage across VS Code windows. */
export const SHARED_STORE_DIRNAME = '.codex-switch'
/** Subdirectory containing individual profile secret files. */
export const SHARED_PROFILES_DIRNAME = 'profiles'
/** Subdirectory containing per-Codex-home active profile selections. */
export const SHARED_ACTIVE_PROFILES_DIRNAME = 'active-profiles'
/** Filename for the consolidated profiles metadata index. */
export const SHARED_PROFILES_FILENAME = 'profiles.json'
/** Filename for the global active profile (deprecated in favor of per-home files). */
export const SHARED_ACTIVE_PROFILE_FILENAME = 'active-profile.json'

/** Tracks which profile is active for a specific Codex home. */
export interface SharedActiveProfile {
  /** ID of the currently selected profile. */
  profileId: string
  /** ISO 8601 timestamp when this selection was last changed. */
  updatedAt: string
}

interface SharedProfileStoreClockDeps {
  now?: () => number
}

/** Returns the root directory path for all shared codex-switch data in the user's home. */
export function getSharedStoreRoot(): string {
  return path.join(os.homedir(), SHARED_STORE_DIRNAME)
}

/** Returns the directory path containing individual profile secret JSON files. */
export function getSharedProfilesDir(): string {
  return path.join(getSharedStoreRoot(), SHARED_PROFILES_DIRNAME)
}

/** Returns the directory path containing per-home active profile selections. */
export function getSharedActiveProfilesDir(): string {
  return path.join(getSharedStoreRoot(), SHARED_ACTIVE_PROFILES_DIRNAME)
}

/** Returns the path to the profiles metadata index file. */
export function getSharedProfilesPath(): string {
  return path.join(getSharedStoreRoot(), SHARED_PROFILES_FILENAME)
}

/** Returns the path to the global active profile file (deprecated). */
export function getSharedActiveProfilePath(): string {
  return path.join(getSharedStoreRoot(), SHARED_ACTIVE_PROFILE_FILENAME)
}

/** Returns the per-home active profile selection file path for a given Codex home ID. */
export function getSharedActiveProfilePathForHome(homeId: string): string {
  return path.join(getSharedActiveProfilesDir(), `${homeId}.json`)
}

/** Returns the file path where secrets for a profile are stored. */
export function getSharedProfileSecretsPath(profileId: string): string {
  return path.join(getSharedProfilesDir(), `${profileId}.json`)
}

/** Creates the shared store directory structure with secure permissions (0o700 on Unix). */
export function ensureSharedStoreDirs(): void {
  const storeRoot = getSharedStoreRoot()
  const profilesDir = getSharedProfilesDir()
  const activeProfilesDir = getSharedActiveProfilesDir()

  fs.mkdirSync(storeRoot, { recursive: true, mode: 0o700 })
  fs.mkdirSync(profilesDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(activeProfilesDir, {
    recursive: true,
    mode: 0o700,
  })

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(storeRoot, 0o700)
    } catch {
      // Ignore best-effort permission correction failures.
    }
    try {
      fs.chmodSync(profilesDir, 0o700)
    } catch {
      // Ignore best-effort permission correction failures.
    }
    try {
      fs.chmodSync(activeProfilesDir, 0o700)
    } catch {
      // Ignore best-effort permission correction failures.
    }
  }
}

/** Safely reads and parses a JSON file, returning null if it does not exist or is malformed. */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

/** Atomically writes data to a JSON file using a temp-and-rename pattern for crash-safety and secure permissions. */
export function writeJsonFile(
  filePath: string,
  data: unknown,
  deps: SharedProfileStoreClockDeps = {},
): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, 0o700)
    } catch {
      // Ignore best-effort permission correction failures.
    }
  }

  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.tmp.${process.pid}.${(deps.now ?? Date.now)()}.${randomUUID()}`,
  )
  const content = `${JSON.stringify(data, null, 2)}\n`

  fs.writeFileSync(tmpPath, content, {
    encoding: 'utf8',
    mode: 0o600,
  })

  try {
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    if (process.platform === 'win32') {
      try {
        fs.rmSync(filePath, { force: true })
        fs.renameSync(tmpPath, filePath)
      } catch {
        fs.copyFileSync(tmpPath, filePath)
      }
      return
    }
    throw error
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath)
      }
    } catch {
      // ignore cleanup failures
    }
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // Ignore best-effort permission correction failures.
    }
  }
}

/** Safely deletes a file if it exists, silently ignoring any errors. */
export function deleteFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // ignore cleanup failures
  }
}
