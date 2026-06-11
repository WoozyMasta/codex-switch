import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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
  fs.mkdirSync(getSharedStoreRoot(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(getSharedProfilesDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(getSharedActiveProfilesDir(), {
    recursive: true,
    mode: 0o700,
  })
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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
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
