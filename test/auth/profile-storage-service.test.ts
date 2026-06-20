import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import type * as vscode from 'vscode'
import type { AuthData, ProfileSummary } from '../../src/types'
import { ProfileStorageService } from '../../src/auth/profile-storage-service'
import { buildProfileSecretKeys } from '../../src/utils/profile-secret-keys'
import { buildProfileTokensFromAuth } from '../../src/utils/profile-records'
const profileFilesStorage =
  require('../../src/utils/profile-files-storage') as {
    writeProfilesFile: typeof import('../../src/utils/profile-files-storage').writeProfilesFile
  }

function makeProfile(id: string, name: string): ProfileSummary {
  const timestamp = '2026-06-19T00:00:00.000Z'
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    planType: 'plus',
    accountId: `${id}-account`,
    defaultOrganizationId: `${id}-org`,
    defaultOrganizationTitle: `${name} Org`,
    chatgptUserId: `${id}-chatgpt`,
    userId: `${id}-user`,
    subject: `${id}-subject`,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function makeAuthData(id: string): AuthData {
  return {
    idToken: `${id}-id`,
    accessToken: `${id}-access`,
    refreshToken: `${id}-refresh`,
    accountId: `${id}-account`,
    defaultOrganizationId: `${id}-org`,
    defaultOrganizationTitle: `${id} Org`,
    chatgptUserId: `${id}-chatgpt`,
    userId: `${id}-user`,
    subject: `${id}-subject`,
    email: `${id}@example.com`,
    planType: 'plus',
    authJson: {
      tokens: {
        id_token: `${id}-id`,
        access_token: `${id}-access`,
        refresh_token: `${id}-refresh`,
        account_id: `${id}-account`,
      },
    },
  }
}

function makeSecrets(
  initial: Record<string, string> = {},
  behavior: {
    store?: (key: string, value: string) => void | Promise<void>
    delete?: (key: string) => void | Promise<void>
  } = {},
) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    secrets: {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => {
        await behavior.store?.(key, value)
        values.set(key, value)
      },
      delete: async (key: string) => {
        await behavior.delete?.(key)
        values.delete(key)
      },
    },
  }
}

function makeService(dir: string, secrets = makeSecrets()) {
  return {
    secrets,
    service: new ProfileStorageService({
      fs,
      globalState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      } as unknown as vscode.Memento,
      workspaceState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      } as unknown as vscode.Memento,
      secrets: {
        ...secrets.secrets,
        keys: () => [],
        onDidChange: (() => ({
          dispose: () => undefined,
        })) as unknown as vscode.Event<vscode.SecretStorageChangeEvent>,
      } as unknown as vscode.SecretStorage,
      globalStorageUri: { fsPath: dir } as unknown as vscode.Uri,
      isRemoteFilesMode: () => false,
      getActiveCodexHome: () =>
        ({
          id: 'default',
          path: dir,
          isDefault: true,
        }) as never,
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      translate: ((message: string) =>
        message) as unknown as typeof vscode.l10n.t,
    }),
  }
}

function seedProfile(
  dir: string,
  secrets: ReturnType<typeof makeSecrets>,
  profile: ProfileSummary,
  auth: AuthData,
): void {
  profileFilesStorage.writeProfilesFile(
    {
      ensureStorageDir: () => {
        fs.mkdirSync(dir, { recursive: true })
      },
      getProfilesPath: () => path.join(dir, 'profiles.json'),
      writeJsonFile: (file: string, data) => {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8')
      },
    },
    { version: 1, profiles: [profile] },
  )
  secrets.values.set(
    buildProfileSecretKeys(profile.id).current,
    JSON.stringify(buildProfileTokensFromAuth(auth)),
  )
}

function makeRefreshedAuth(
  id: string,
  options: { suffix?: string; lastRefresh?: number } = {},
): AuthData {
  const suffix = options.suffix ?? '2'
  const base = makeAuthData(id)
  const tokens: Record<string, unknown> = {
    id_token: `${id}-id`,
    access_token: `${id}-access-${suffix}`,
    refresh_token: `${id}-refresh-${suffix}`,
    account_id: `${id}-account`,
  }
  const authJson: Record<string, unknown> = { tokens }
  if (options.lastRefresh !== undefined) {
    authJson.last_refresh = options.lastRefresh
  }
  return {
    ...base,
    accessToken: `${id}-access-${suffix}`,
    refreshToken: `${id}-refresh-${suffix}`,
    authJson,
  }
}

const PROFILE_ID = '123e4567-e89b-12d3-a456-426614174000'

test('replaceProfileAuthIfFresher reports missing for an unknown profile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const { service } = makeService(dir)
  const result = await service.replaceProfileAuthIfFresher(
    'unknown',
    makeRefreshedAuth('alpha', { lastRefresh: 100 }),
    makeAuthData('alpha'),
  )
  assert.equal(result, 'missing')
})

test('replaceProfileAuthIfFresher leaves unchanged auth untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const auth = makeAuthData(PROFILE_ID)
  seedProfile(dir, secrets, profile, auth)

  const result = await service.replaceProfileAuthIfFresher(
    PROFILE_ID,
    auth,
    auth,
  )
  assert.equal(result, 'unchanged')
})

test('replaceProfileAuthIfFresher persists newer matching auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const baseline = makeAuthData(PROFILE_ID)
  seedProfile(dir, secrets, profile, baseline)

  const refreshed = makeRefreshedAuth(PROFILE_ID, { lastRefresh: 5000 })
  const result = await service.replaceProfileAuthIfFresher(
    PROFILE_ID,
    refreshed,
    baseline,
  )
  assert.equal(result, 'updated')

  const stored = await service.readStoredTokens(PROFILE_ID)
  assert.equal(stored?.refreshToken, `${PROFILE_ID}-refresh-2`)
})

test('replaceProfileAuthIfFresher rejects older temporary auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const baseline = makeRefreshedAuth(PROFILE_ID, {
    suffix: '1',
    lastRefresh: 9000,
  })
  seedProfile(dir, secrets, profile, baseline)

  const older = makeRefreshedAuth(PROFILE_ID, {
    suffix: '2',
    lastRefresh: 1000,
  })
  const result = await service.replaceProfileAuthIfFresher(
    PROFILE_ID,
    older,
    baseline,
  )
  assert.equal(result, 'unchanged')
})

test('replaceProfileAuthIfFresher rejects incomplete auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const baseline = makeAuthData(PROFILE_ID)
  seedProfile(dir, secrets, profile, baseline)

  const incomplete: AuthData = {
    ...baseline,
    authJson: { tokens: { id_token: `${PROFILE_ID}-id` } },
  }
  const result = await service.replaceProfileAuthIfFresher(
    PROFILE_ID,
    incomplete,
    baseline,
  )
  assert.equal(result, 'conflict')
})

test('replaceProfileAuthIfFresher rejects mismatched identity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const baseline = makeAuthData(PROFILE_ID)
  seedProfile(dir, secrets, profile, baseline)

  const mismatched: AuthData = {
    ...makeRefreshedAuth(PROFILE_ID, { lastRefresh: 5000 }),
    userId: 'someone-else',
    subject: 'someone-else',
  }
  const result = await service.replaceProfileAuthIfFresher(
    PROFILE_ID,
    mismatched,
    baseline,
  )
  assert.equal(result, 'conflict')
})

test('replaceProfileAuthIfFresher overrides a concurrent change only when strictly newer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const profile = makeProfile(PROFILE_ID, 'Alpha')
  const baseline = makeAuthData(PROFILE_ID)
  // Storage was concurrently changed to a newer import after Codex started.
  const concurrent = makeRefreshedAuth(PROFILE_ID, {
    suffix: 'c',
    lastRefresh: 2000,
  })
  seedProfile(dir, secrets, profile, concurrent)

  const sameAge = makeRefreshedAuth(PROFILE_ID, {
    suffix: '2',
    lastRefresh: 2000,
  })
  assert.equal(
    await service.replaceProfileAuthIfFresher(PROFILE_ID, sameAge, baseline),
    'conflict',
  )

  const strictlyNewer = makeRefreshedAuth(PROFILE_ID, {
    suffix: '3',
    lastRefresh: 3000,
  })
  assert.equal(
    await service.replaceProfileAuthIfFresher(
      PROFILE_ID,
      strictlyNewer,
      baseline,
    ),
    'updated',
  )
})

async function withPlatform<T>(
  platform: NodeJS.Platform,
  run: () => T | Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) {
    throw new Error('process.platform descriptor is unavailable')
  }

  Object.defineProperty(process, 'platform', {
    ...descriptor,
    value: platform,
  })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

test('ProfileStorageService rolls back created secrets when profile metadata write fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const { service, secrets } = makeService(dir)
  const originalRenameSync = fs.renameSync
  const originalChmodSync = fs.chmodSync

  fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
    void args
    throw new Error('rename failed')
  }) as typeof fs.renameSync
  fs.chmodSync = (() => {}) as typeof fs.chmodSync

  try {
    await withPlatform('linux', async () => {
      await assert.rejects(
        () => service.createProfile('Alice', makeAuthData('alice')),
        /rename failed/,
      )
    })

    assert.equal(secrets.values.size, 0)
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.renameSync = originalRenameSync
    fs.chmodSync = originalChmodSync
  }
})

test('ProfileStorageService restores previous secrets when profile replacement fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const profile = makeProfile('123e4567-e89b-12d3-a456-426614174000', 'Alpha')
  const originalTokens = makeAuthData(profile.id)
  const updatedAuth = makeAuthData('123e4567-e89b-12d3-a456-426614174001')
  const secrets = makeSecrets()
  const { service } = makeService(dir, secrets)
  const originalWriteProfilesFile = profileFilesStorage.writeProfilesFile

  profileFilesStorage.writeProfilesFile(
    {
      ensureStorageDir: () => {
        fs.mkdirSync(dir, { recursive: true })
      },
      getProfilesPath: () => path.join(dir, 'profiles.json'),
      writeJsonFile: (file: string, data) => {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8')
      },
    },
    { version: 1, profiles: [profile] },
  )

  const secretKeys = buildProfileSecretKeys(profile.id)
  secrets.values.set(secretKeys.current, JSON.stringify(originalTokens))

  profileFilesStorage.writeProfilesFile = ((
    ...args: Parameters<typeof profileFilesStorage.writeProfilesFile>
  ) => {
    void args
    throw new Error('write failed')
  }) as typeof profileFilesStorage.writeProfilesFile

  try {
    await assert.rejects(
      () => service.replaceProfileAuth(profile.id, updatedAuth),
      /write failed/,
    )

    assert.deepEqual(await service.readStoredTokens(profile.id), originalTokens)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8')),
      {
        version: 1,
        profiles: [profile],
      },
    )
  } finally {
    profileFilesStorage.writeProfilesFile = originalWriteProfilesFile
  }
})

test('ProfileStorageService propagates SecretStorage store failure on createProfile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const { service, secrets } = makeService(
    dir,
    makeSecrets(
      {},
      {
        store: async () => {
          throw new Error('secret store failed')
        },
      },
    ),
  )

  await assert.rejects(
    () => service.createProfile('Alice', makeAuthData('alice')),
    /secret store failed/,
  )

  assert.equal(secrets.values.size, 0)
  assert.equal(fs.readdirSync(dir).length, 0)
})

test('ProfileStorageService propagates SecretStorage store failure on replaceProfileAuth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-storage-'))
  const profile = makeProfile('123e4567-e89b-12d3-a456-426614174000', 'Alpha')
  const originalAuth = makeAuthData(profile.id)
  const updatedAuth = makeAuthData('123e4567-e89b-12d3-a456-426614174001')
  const secrets = makeSecrets(
    {
      [buildProfileSecretKeys(profile.id).current]:
        JSON.stringify(originalAuth),
    },
    {
      store: async () => {
        throw new Error('secret store failed')
      },
    },
  )
  const { service } = makeService(dir, secrets)

  profileFilesStorage.writeProfilesFile(
    {
      ensureStorageDir: () => {
        fs.mkdirSync(dir, { recursive: true })
      },
      getProfilesPath: () => path.join(dir, 'profiles.json'),
      writeJsonFile: (file: string, data) => {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8')
      },
    },
    { version: 1, profiles: [profile] },
  )

  await assert.rejects(
    () => service.replaceProfileAuth(profile.id, updatedAuth),
    /secret store failed/,
  )

  assert.deepEqual(await service.readStoredTokens(profile.id), originalAuth)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8')),
    {
      version: 1,
      profiles: [profile],
    },
  )
})
