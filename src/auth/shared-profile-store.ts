/* eslint-disable @typescript-eslint/no-require-imports */
import fs = require('fs')
import os = require('os')
import path = require('path')
/* eslint-enable @typescript-eslint/no-require-imports */
import { randomUUID } from 'crypto'

export const SHARED_STORE_DIRNAME = '.codex-switch'
export const SHARED_PROFILES_DIRNAME = 'profiles'
export const SHARED_ACTIVE_PROFILES_DIRNAME = 'active-profiles'
export const SHARED_PROFILES_FILENAME = 'profiles.json'
export const SHARED_ACTIVE_PROFILE_FILENAME = 'active-profile.json'

export interface SharedActiveProfile {
  profileId: string
  updatedAt: string
}

export function getSharedStoreRoot(): string {
  return path.join(os.homedir(), SHARED_STORE_DIRNAME)
}

export function getSharedProfilesDir(): string {
  return path.join(getSharedStoreRoot(), SHARED_PROFILES_DIRNAME)
}

export function getSharedActiveProfilesDir(): string {
  return path.join(getSharedStoreRoot(), SHARED_ACTIVE_PROFILES_DIRNAME)
}

export function getSharedProfilesPath(): string {
  return path.join(getSharedStoreRoot(), SHARED_PROFILES_FILENAME)
}

export function getSharedActiveProfilePath(): string {
  return path.join(getSharedStoreRoot(), SHARED_ACTIVE_PROFILE_FILENAME)
}

export function getSharedActiveProfilePathForHome(homeId: string): string {
  return path.join(getSharedActiveProfilesDir(), `${homeId}.json`)
}

export function getSharedProfileSecretsPath(profileId: string): string {
  return path.join(getSharedProfilesDir(), `${profileId}.json`)
}

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

export function writeJsonFile(filePath: string, data: unknown): void {
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
    `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`,
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

export function deleteFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // ignore cleanup failures
  }
}
