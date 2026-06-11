import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData } from '../../src/types'
import {
  getCanonicalTokenBundle,
  validateImportedAuthJson,
} from '../../src/utils/auth-payload'

const baseAuthData = {
  idToken: '',
  accessToken: '',
  refreshToken: '',
  email: '',
  planType: '',
} as AuthData

test('getCanonicalTokenBundle extracts canonical tokens only from valid authJson', () => {
  assert.equal(getCanonicalTokenBundle(baseAuthData), undefined)
  assert.equal(
    getCanonicalTokenBundle({
      ...baseAuthData,
      authJson: {
        tokens: null,
      },
    }),
    undefined,
  )

  assert.equal(
    getCanonicalTokenBundle({
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: 123,
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
    }),
    undefined,
  )

  assert.equal(
    getCanonicalTokenBundle({
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: '   ',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
    }),
    undefined,
  )

  assert.equal(
    getCanonicalTokenBundle({
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: 'id',
          access_token: 'access',
        },
      },
    }),
    undefined,
  )

  assert.deepEqual(
    getCanonicalTokenBundle({
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: ' id ',
          access_token: ' access ',
          refresh_token: ' refresh ',
        },
      },
    }),
    {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
    },
  )
})

test('validateImportedAuthJson accepts matching nested tokens and rejects mismatches', () => {
  const authJson = {
    tokens: {
      id_token: 'id',
      access_token: 'access',
      refresh_token: 'refresh',
      account_id: 'acc-1',
    },
  }

  assert.equal(
    validateImportedAuthJson('not-an-object', {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
    }),
    null,
  )

  assert.equal(
    validateImportedAuthJson(
      {
        tokens: null,
      },
      {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    ),
    null,
  )

  assert.equal(
    validateImportedAuthJson(
      {
        tokens: {
          id_token: 'id',
        },
      },
      {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    ),
    null,
  )

  assert.equal(
    validateImportedAuthJson(authJson, {
      idToken: 'id',
      accessToken: 'wrong',
      refreshToken: 'refresh',
    }),
    null,
  )

  assert.equal(
    validateImportedAuthJson(authJson, {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      accountId: 'acc-2',
    }),
    null,
  )

  assert.deepEqual(
    validateImportedAuthJson(authJson, {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      accountId: 'acc-1',
    }),
    authJson,
  )

  assert.deepEqual(
    validateImportedAuthJson(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    ),
    {
      tokens: {
        id_token: 'id',
        access_token: 'access',
        refresh_token: 'refresh',
      },
    },
  )

  assert.deepEqual(
    validateImportedAuthJson(
      {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
      {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
        accountId: 'acc-1',
      },
    ),
    {
      tokens: {
        id_token: 'id',
        access_token: 'access',
        refresh_token: 'refresh',
      },
    },
  )
})
