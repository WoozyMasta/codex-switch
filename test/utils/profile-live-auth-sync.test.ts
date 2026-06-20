/** Tests for profile-live-auth-sync. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import {
  captureLiveAuthForMatchingProfile,
  maybeSyncProfileAuthToCodexAuthFile,
} from '../../src/utils/profile-live-auth-sync'

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

const auth = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
  defaultOrganizationId: 'org-1',
  chatgptUserId: 'user-1',
  authJson: {
    tokens: {
      id_token: 'id',
      access_token: 'access',
      refresh_token: 'refresh',
    },
  },
} as AuthData

test('maybeSyncProfileAuthToCodexAuthFile syncs only when profile is fresh', async () => {
  const loaded: string[] = []
  const synced: Array<[string, AuthData]> = []

  await maybeSyncProfileAuthToCodexAuthFile(
    {
      lastSyncedProfileId: 'cached',
      loadAuthData: async (profileId) => {
        loaded.push(profileId)
        return auth
      },
      syncProfileAuthToCodexAuthFile: (profileId, authData) => {
        synced.push([profileId, authData])
      },
    },
    'cached',
  )

  await maybeSyncProfileAuthToCodexAuthFile(
    {
      lastSyncedProfileId: undefined,
      loadAuthData: async (profileId) => {
        loaded.push(profileId)
        return auth
      },
      syncProfileAuthToCodexAuthFile: (profileId, authData) => {
        synced.push([profileId, authData])
      },
    },
    'active',
  )

  await maybeSyncProfileAuthToCodexAuthFile(
    {
      lastSyncedProfileId: undefined,
      loadAuthData: async (profileId) => {
        loaded.push(profileId)
        return null
      },
      syncProfileAuthToCodexAuthFile: (profileId, authData) => {
        synced.push([profileId, authData])
      },
    },
    'missing',
  )

  await maybeSyncProfileAuthToCodexAuthFile(
    {
      lastSyncedProfileId: undefined,
      loadAuthData: async (profileId) => {
        loaded.push(profileId)
        return auth
      },
      syncProfileAuthToCodexAuthFile: (profileId, authData) => {
        synced.push([profileId, authData])
      },
    },
    '' as unknown as string,
  )

  assert.deepEqual(loaded, ['active', 'missing'])
  assert.deepEqual(synced, [['active', auth]])
})

test('captureLiveAuthForMatchingProfile skips unchanged or unmatched auth', async () => {
  const hashes: string[] = []
  const liveLoads: number[] = []
  const matches: number[] = []
  const replacements: Array<[string, AuthData]> = []

  await captureLiveAuthForMatchingProfile(
    {
      lastSyncedAuthHash: 'hash',
      readAuthFileHash: () => undefined,
      loadLiveCodexAuthData: async () => {
        liveLoads.push(1)
        return auth
      },
      findProfileByPreservationIdentity: async () => {
        matches.push(1)
        return profile
      },
      maybeReplaceProfileAuthWithLive: async (matchedProfile, liveAuth) => {
        replacements.push([matchedProfile.id, liveAuth])
        return true
      },
    },
    'auth.json',
  )

  await captureLiveAuthForMatchingProfile(
    {
      lastSyncedAuthHash: 'hash',
      readAuthFileHash: () => 'hash',
      loadLiveCodexAuthData: async () => {
        liveLoads.push(2)
        return auth
      },
      findProfileByPreservationIdentity: async () => {
        matches.push(2)
        return profile
      },
      maybeReplaceProfileAuthWithLive: async (matchedProfile, liveAuth) => {
        replacements.push([matchedProfile.id, liveAuth])
        return true
      },
    },
    'auth.json',
  )

  await captureLiveAuthForMatchingProfile(
    {
      lastSyncedAuthHash: 'other',
      readAuthFileHash: () => 'new-hash',
      loadLiveCodexAuthData: async () => {
        liveLoads.push(3)
        return null
      },
      findProfileByPreservationIdentity: async () => {
        matches.push(3)
        return profile
      },
      maybeReplaceProfileAuthWithLive: async (matchedProfile, liveAuth) => {
        replacements.push([matchedProfile.id, liveAuth])
        return true
      },
    },
    'auth.json',
  )

  await captureLiveAuthForMatchingProfile(
    {
      lastSyncedAuthHash: 'other',
      readAuthFileHash: () => 'new-hash',
      loadLiveCodexAuthData: async () => {
        liveLoads.push(4)
        return auth
      },
      findProfileByPreservationIdentity: async () => {
        matches.push(4)
        return undefined
      },
      maybeReplaceProfileAuthWithLive: async (matchedProfile, liveAuth) => {
        replacements.push([matchedProfile.id, liveAuth])
        return true
      },
    },
    'auth.json',
  )

  await captureLiveAuthForMatchingProfile(
    {
      lastSyncedAuthHash: 'other',
      readAuthFileHash: () => 'new-hash',
      loadLiveCodexAuthData: async () => {
        liveLoads.push(5)
        return auth
      },
      findProfileByPreservationIdentity: async () => {
        matches.push(5)
        return profile
      },
      maybeReplaceProfileAuthWithLive: async (matchedProfile, liveAuth) => {
        replacements.push([matchedProfile.id, liveAuth])
        return true
      },
    },
    'auth.json',
  )

  assert.deepEqual(hashes, [])
  assert.deepEqual(liveLoads, [3, 4, 5])
  assert.deepEqual(matches, [4, 5])
  assert.deepEqual(replacements, [
    ['123e4567-e89b-12d3-a456-426614174000', auth],
  ])
})
