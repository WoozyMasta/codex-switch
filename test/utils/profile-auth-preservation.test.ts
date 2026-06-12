import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../../src/utils/profile-auth-preservation'

const baseProfile = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  planType: 'pro',
  defaultOrganizationId: 'org-1',
  chatgptUserId: 'user-1',
  createdAt: '2026-06-12T10:00:00.000Z',
  updatedAt: '2026-06-12T10:00:00.000Z',
} as ProfileSummary

function makeAuth(
  overrides: Partial<AuthData> & {
    tokenId?: string
    accessToken?: string
    refreshToken?: string
  } = {},
): AuthData {
  const {
    tokenId = 'id',
    accessToken = 'access',
    refreshToken = 'refresh',
    ...rest
  } = overrides

  return {
    idToken: tokenId,
    accessToken,
    refreshToken,
    email: 'alice@example.com',
    planType: 'pro',
    defaultOrganizationId: 'org-1',
    chatgptUserId: 'user-1',
    authJson: {
      tokens: {
        id_token: tokenId,
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      last_refresh: '2026-06-12T10:00:00Z',
    },
    ...rest,
  }
}

test('maybeReplaceProfileAuthWithLive replaces matching stored auth when live is newer', async () => {
  const storedAuth = makeAuth({
    authJson: {
      tokens: {
        id_token: 'id',
        access_token: 'access',
        refresh_token: 'refresh',
      },
      last_refresh: '2026-06-12T10:00:00Z',
    },
  })
  const liveAuth = makeAuth({
    tokenId: 'new-id',
    authJson: {
      tokens: {
        id_token: 'new-id',
        access_token: 'access',
        refresh_token: 'refresh',
      },
      last_refresh: '2026-06-12T11:00:00Z',
    },
  })
  const replaced: Array<[string, AuthData]> = []

  assert.equal(
    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: async () => storedAuth,
        replaceProfileAuth: async (profileId, authData) => {
          replaced.push([profileId, authData])
          return true
        },
      },
      baseProfile,
      liveAuth,
    ),
    true,
  )
  assert.deepEqual(replaced, [
    ['123e4567-e89b-12d3-a456-426614174000', liveAuth],
  ])
})

test('maybeReplaceProfileAuthWithLive rejects mismatched identity and stale live auth', async () => {
  const liveAuth = makeAuth()
  const rejected: Array<string> = []

  assert.equal(
    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: async () => ({
          ...makeAuth(),
          defaultOrganizationId: 'org-2',
        }),
        replaceProfileAuth: async (profileId) => {
          rejected.push(profileId)
          return true
        },
      },
      baseProfile,
      liveAuth,
    ),
    false,
  )

  assert.equal(
    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: async () =>
          makeAuth({
            authJson: {
              tokens: {
                id_token: 'id',
                access_token: 'access',
                refresh_token: 'refresh',
              },
              last_refresh: '2026-06-12T11:00:00Z',
            },
          }),
        replaceProfileAuth: async (profileId) => {
          rejected.push(profileId)
          return true
        },
      },
      baseProfile,
      makeAuth({
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
          last_refresh: '2026-06-12T10:00:00Z',
        },
      }),
    ),
    false,
  )

  assert.deepEqual(rejected, [])
})

test('maybeReplaceProfileAuthWithLive forwards replacement failure', async () => {
  assert.equal(
    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: async () => makeAuth(),
        replaceProfileAuth: async () => false,
      },
      baseProfile,
      makeAuth({
        tokenId: 'new-id',
        authJson: {
          tokens: {
            id_token: 'new-id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      }),
    ),
    false,
  )
})

test('findProfileByPreservationIdentity respects preferred profile ordering', async () => {
  const profiles = [
    { ...baseProfile, id: 'match-late' },
    { ...baseProfile, id: 'preferred' },
  ] as ProfileSummary[]
  const liveAuth = makeAuth()
  const calls: string[] = []

  const found = await findProfileByPreservationIdentity(
    {
      listProfiles: async () => profiles,
      loadAuthData: async (profileId) => {
        calls.push(profileId)
        return profileId === 'preferred'
          ? makeAuth()
          : makeAuth({
              tokenId: 'other',
              authJson: {
                tokens: {
                  id_token: 'other',
                  access_token: 'access',
                  refresh_token: 'refresh',
                },
              },
            })
      },
    },
    liveAuth,
    'preferred',
  )

  assert.equal(found?.id, 'preferred')
  assert.deepEqual(calls, ['preferred'])

  assert.equal(
    await findProfileByPreservationIdentity(
      {
        listProfiles: async () => [],
        loadAuthData: async () => null,
      },
      liveAuth,
    ),
    undefined,
  )
})
