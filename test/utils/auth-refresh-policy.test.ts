import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData } from '../../src/types'
import {
  getAuthLastRefresh,
  parseAuthLastRefresh,
  shouldReplaceStoredProfileAuthWithLive,
} from '../../src/utils/auth-refresh-policy'

const baseAuthData = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
} as AuthData

test('parseAuthLastRefresh normalizes numeric and date refresh values', () => {
  assert.equal(parseAuthLastRefresh(123), 123)
  assert.equal(parseAuthLastRefresh(Number.POSITIVE_INFINITY), undefined)
  assert.equal(parseAuthLastRefresh(' 456 '), 456)
  assert.equal(
    parseAuthLastRefresh('2026-06-12T10:00:00Z'),
    Date.parse('2026-06-12T10:00:00Z'),
  )
  assert.equal(parseAuthLastRefresh('   '), undefined)
  assert.equal(parseAuthLastRefresh('invalid'), undefined)
})

test('getAuthLastRefresh reads the last_refresh field from authJson', () => {
  assert.equal(getAuthLastRefresh(null), undefined)
  assert.equal(
    getAuthLastRefresh({
      ...baseAuthData,
      authJson: {},
    }),
    undefined,
  )
  assert.equal(
    getAuthLastRefresh({
      ...baseAuthData,
      authJson: {
        last_refresh: '2026-06-12T10:00:00Z',
      },
    }),
    Date.parse('2026-06-12T10:00:00Z'),
  )
})

test('shouldReplaceStoredProfileAuthWithLive follows token and refresh policy', () => {
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(null, {
      ...baseAuthData,
      authJson: {
        tokens: {
          id_token: 'id',
          access_token: 'access',
          refresh_token: 'refresh',
        },
      },
    }),
    true,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
    ),
    false,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
          last_refresh: '2026-06-12T11:00:00Z',
        },
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
          last_refresh: '2026-06-12T10:00:00Z',
        },
      },
    ),
    false,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
          last_refresh: '2026-06-12T10:00:00Z',
        },
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
    ),
    false,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
          last_refresh: '2026-06-12T10:00:00Z',
        },
      },
    ),
    true,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id-2',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
    ),
    true,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {},
      },
      {
        ...baseAuthData,
        authJson: null as unknown as Record<string, unknown>,
      },
    ),
    false,
  )
  assert.equal(
    shouldReplaceStoredProfileAuthWithLive(
      {
        ...baseAuthData,
        authJson: {},
      },
      {
        ...baseAuthData,
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      },
    ),
    true,
  )
})
