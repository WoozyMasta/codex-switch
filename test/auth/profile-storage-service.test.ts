import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import type * as vscode from 'vscode'
import type { AuthData, ProfileSummary } from '../../src/types'
import { ProfileStorageService } from '../../src/auth/profile-storage-service'
import { buildProfileSecretKeys } from '../../src/utils/profile-secret-keys'
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

function makeSecrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    secrets: {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => {
        values.set(key, value)
      },
      delete: async (key: string) => {
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
