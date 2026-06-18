import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import { ProfileAuthFileService } from '../../src/auth/profile-auth-file-service'
import { sha256Text } from '../../src/utils/text-hash'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

const profile = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  planType: 'pro',
  defaultOrganizationId: 'org-1',
  chatgptUserId: 'user-1',
  createdAt: '2026-06-12T10:00:00.000Z',
  updatedAt: '2026-06-12T10:00:00.000Z',
} as ProfileSummary

const idToken = makeJwt({
  sub: 'user-1',
  email: 'alice@example.com',
  'https://api.openai.com/auth': {
    chatgpt_user_id: 'user-1',
    chatgpt_plan_type: 'pro',
    default_organization_id: 'org-1',
  },
})

const authData = {
  idToken,
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
  defaultOrganizationId: 'org-1',
  chatgptUserId: 'user-1',
  authJson: {
    tokens: {
      id_token: idToken,
      access_token: 'access',
      refresh_token: 'refresh',
    },
  },
} as AuthData

function buildCodexAuthJson(authData: AuthData): string {
  if (authData.authJson) {
    return `${JSON.stringify(authData.authJson, null, 2)}\n`
  }
  return `${JSON.stringify(
    {
      tokens: {
        id_token: authData.idToken,
        access_token: authData.accessToken,
        refresh_token: authData.refreshToken,
        ...(authData.accountId ? { account_id: authData.accountId } : {}),
      },
    },
    null,
    2,
  )}\n`
}

function syncCodexAuthFile(authPath: string, authData: AuthData): void {
  fs.mkdirSync(path.dirname(authPath), { recursive: true })
  fs.writeFileSync(authPath, buildCodexAuthJson(authData), 'utf8')
}

function createService(authPath: string, loadAuthDataCalls: string[]) {
  return new ProfileAuthFileService({
    fs,
    getActiveCodexAuthPath: () => authPath,
    loadLiveCodexAuthData: async () => {
      return fs.existsSync(authPath) ? authData : null
    },
    buildCodexAuthJson,
    syncCodexAuthFile,
    sha256Text,
    listProfiles: async () => [profile],
    loadAuthData: async (profileId) => {
      loadAuthDataCalls.push(profileId)
      return profileId === profile.id ? authData : null
    },
    replaceProfileAuth: async () => true,
  })
}

test('ProfileAuthFileService caches synced profile id and resets it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const authPath = path.join(dir, 'auth.json')
  const loadAuthDataCalls: string[] = []
  const service = createService(authPath, loadAuthDataCalls)

  await service.syncActiveProfileToCodexAuthFile(profile.id)
  await service.syncActiveProfileToCodexAuthFile(profile.id)

  assert.equal(loadAuthDataCalls.length, 1)
  assert.equal(fs.existsSync(authPath), true)

  service.resetSyncCache()
  await service.syncActiveProfileToCodexAuthFile(profile.id)

  assert.equal(loadAuthDataCalls.length, 2)
})

test('ProfileAuthFileService reads, infers, and deletes the live auth file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const authPath = path.join(dir, 'auth.json')
  const service = createService(authPath, [])

  assert.equal(service.hasActiveCodexAuthFile(), false)

  service.syncProfileAuthToCodexAuthFile(profile.id, authData)

  assert.equal(service.hasActiveCodexAuthFile(), true)
  assert.equal((await service.loadLiveCodexAuthData())?.email, authData.email)
  assert.equal(await service.inferActiveProfileIdFromAuthFile(), profile.id)

  service.deleteActiveCodexAuthFile()

  assert.equal(service.hasActiveCodexAuthFile(), false)
})

test('ProfileAuthFileService capture skips unchanged auth and processes updates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const authPath = path.join(dir, 'auth.json')
  const loadAuthDataCalls: string[] = []
  const service = new ProfileAuthFileService({
    fs,
    getActiveCodexAuthPath: () => authPath,
    loadLiveCodexAuthData: async () => {
      return fs.existsSync(authPath) ? authData : null
    },
    buildCodexAuthJson,
    syncCodexAuthFile,
    sha256Text,
    listProfiles: async () => [profile],
    loadAuthData: async (profileId) => {
      loadAuthDataCalls.push(profileId)
      return profileId === profile.id ? authData : null
    },
    replaceProfileAuth: async () => true,
  })

  service.syncProfileAuthToCodexAuthFile(profile.id, authData)
  await service.captureLiveAuthForMatchingProfile(authPath)

  assert.equal(loadAuthDataCalls.length, 0)

  fs.writeFileSync(authPath, `${fs.readFileSync(authPath, 'utf8')}\n`)
  await service.captureLiveAuthForMatchingProfile(authPath)

  assert.ok(loadAuthDataCalls.length > 0)
})

test('ProfileAuthFileService capture replaces matching stored auth when live is newer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const authPath = path.join(dir, 'auth.json')
  const liveIdToken = makeJwt({
    sub: 'user-1',
    email: 'alice@example.com',
    extra: 'new',
    'https://api.openai.com/auth': {
      chatgpt_user_id: 'user-1',
      chatgpt_plan_type: 'pro',
      default_organization_id: 'org-1',
    },
  })
  const storedAuthData = {
    ...authData,
    authJson: {
      tokens: {
        id_token: idToken,
        access_token: 'access',
        refresh_token: 'refresh',
      },
      last_refresh: '2026-06-12T10:00:00Z',
    },
  } as AuthData
  const liveAuthData = {
    ...authData,
    idToken: liveIdToken,
    authJson: {
      tokens: {
        id_token: liveIdToken,
        access_token: 'access',
        refresh_token: 'refresh',
      },
      last_refresh: '2026-06-12T11:00:00Z',
    },
  } as AuthData
  const replaced: Array<[string, AuthData]> = []
  const service = new ProfileAuthFileService({
    fs,
    getActiveCodexAuthPath: () => authPath,
    loadLiveCodexAuthData: async () => liveAuthData,
    buildCodexAuthJson,
    syncCodexAuthFile,
    sha256Text,
    listProfiles: async () => [profile],
    loadAuthData: async (profileId) =>
      profileId === profile.id ? storedAuthData : null,
    replaceProfileAuth: async (profileId, authData) => {
      replaced.push([profileId, authData])
      return true
    },
  })

  fs.writeFileSync(authPath, '{}', 'utf8')

  await service.captureLiveAuthForMatchingProfile(authPath)

  assert.deepEqual(replaced, [[profile.id, liveAuthData]])
})

test('ProfileAuthFileService capture ignores missing and unreadable auth files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const missingPath = path.join(dir, 'missing-auth.json')
  const loadAuthDataCalls: string[] = []
  const service = createService(missingPath, loadAuthDataCalls)

  await service.captureLiveAuthForMatchingProfile(missingPath)
  assert.equal(loadAuthDataCalls.length, 0)

  const existingPath = path.join(dir, 'existing-auth.json')
  fs.writeFileSync(existingPath, '{}', 'utf8')
  const originalExistsSync = fs.existsSync
  const originalReadFileSync = fs.readFileSync

  fs.existsSync = ((filePath: fs.PathLike) => {
    return String(filePath) === existingPath
      ? true
      : originalExistsSync(filePath)
  }) as typeof fs.existsSync
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === existingPath) {
      throw new Error('read failed')
    }
    return originalReadFileSync(...args)
  }) as typeof fs.readFileSync

  try {
    await service.captureLiveAuthForMatchingProfile(existingPath)
    assert.equal(loadAuthDataCalls.length, 0)
  } finally {
    fs.existsSync = originalExistsSync
    fs.readFileSync = originalReadFileSync
  }
})

test('ProfileAuthFileService inferActiveProfileIdFromAuthFile returns undefined without live auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-file-'))
  const authPath = path.join(dir, 'auth.json')
  const service = new ProfileAuthFileService({
    fs,
    getActiveCodexAuthPath: () => authPath,
    loadLiveCodexAuthData: async () => null,
    buildCodexAuthJson,
    syncCodexAuthFile,
    sha256Text,
    listProfiles: async () => [profile],
    loadAuthData: async () => authData,
    replaceProfileAuth: async () => true,
  })

  assert.equal(await service.inferActiveProfileIdFromAuthFile(), undefined)
})
