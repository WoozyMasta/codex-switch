import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import type { AuthData } from '../../src/types'
import {
  buildCodexAuthJson,
  isObjectRecord,
  requireNonEmptyString,
  syncCodexAuthFile,
} from '../../src/auth/codex-auth-sync'

const baseAuthData = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
} as AuthData

test('buildCodexAuthJson prefers nested authJson and falls back to tokens', () => {
  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: 'nested-id',
          access_token: 'nested-access',
          refresh_token: 'nested-refresh',
        },
      },
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'nested-id',
          access_token: 'nested-access',
          refresh_token: 'nested-refresh',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      accountId: 'account-1',
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
          account_id: 'account-1',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      accountId: '   ',
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      accountId: 123 as unknown as string,
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      authJson: 'not-an-object' as unknown as Record<string, unknown>,
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson({
      ...baseAuthData,
      authJson: null as unknown as Record<string, unknown>,
    }),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      null,
      2,
    )}\n`,
  )

  assert.equal(
    buildCodexAuthJson(baseAuthData),
    `${JSON.stringify(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      null,
      2,
    )}\n`,
  )
})

test('codex auth sync helpers validate objects and required strings', () => {
  assert.equal(isObjectRecord({}), true)
  assert.equal(isObjectRecord([]), true)
  assert.equal(isObjectRecord(null), false)
  assert.equal(isObjectRecord('text'), false)

  assert.equal(requireNonEmptyString('  value  ', 'field'), '  value  ')
  assert.throws(() => requireNonEmptyString('   ', 'field'))
  assert.throws(() => requireNonEmptyString(123 as unknown as string, 'field'))
})

test('buildCodexAuthJson rejects missing required token fields', () => {
  assert.throws(() =>
    buildCodexAuthJson({
      ...baseAuthData,
      idToken: '',
    } as AuthData),
  )
  assert.throws(() =>
    buildCodexAuthJson({
      ...baseAuthData,
      accessToken: '',
    } as AuthData),
  )
  assert.throws(() =>
    buildCodexAuthJson({
      ...baseAuthData,
      refreshToken: '',
    } as AuthData),
  )
})

test('syncCodexAuthFile writes atomically and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-sync-'))
  const authPath = path.join(dir, 'auth.json')

  syncCodexAuthFile(authPath, baseAuthData)

  assert.equal(fs.existsSync(authPath), true)
  assert.equal(
    fs.readFileSync(authPath, 'utf8'),
    buildCodexAuthJson(baseAuthData),
  )
  assert.deepEqual(
    fs.readdirSync(dir).filter((entry) => entry.includes('.tmp.')),
    [],
  )
})

test('syncCodexAuthFile ignores cleanup failures after fallback copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-sync-'))
  const authPath = path.join(dir, 'auth.json')
  const originalRenameSync = fs.renameSync
  const originalUnlinkSync = fs.unlinkSync

  fs.renameSync = (() => {
    throw new Error('rename failed')
  }) as typeof fs.renameSync
  fs.unlinkSync = (() => {
    throw new Error('cleanup failed')
  }) as typeof fs.unlinkSync

  try {
    syncCodexAuthFile(authPath, baseAuthData, {
      now: () => 1234567890,
    })
    assert.equal(
      fs.readFileSync(authPath, 'utf8'),
      buildCodexAuthJson(baseAuthData),
    )
  } finally {
    fs.renameSync = originalRenameSync
    fs.unlinkSync = originalUnlinkSync
  }
})

test('syncCodexAuthFile falls back to copy when rename fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-auth-sync-'))
  const authPath = path.join(dir, 'auth.json')
  const originalRenameSync = fs.renameSync

  fs.renameSync = (() => {
    throw new Error('rename failed')
  }) as typeof fs.renameSync

  try {
    syncCodexAuthFile(authPath, baseAuthData, {
      now: () => 1234567891,
    })
    assert.equal(
      fs.readFileSync(authPath, 'utf8'),
      buildCodexAuthJson(baseAuthData),
    )
    assert.deepEqual(
      fs.readdirSync(dir).filter((entry) => entry.includes('.tmp.')),
      [],
    )
  } finally {
    fs.renameSync = originalRenameSync
  }
})
