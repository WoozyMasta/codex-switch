import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import {
  ProfileTransferService,
  type ExportedProfileEntryV1,
  type ExportedSettingsV1,
} from '../../src/auth/profile-transfer-service'
import type { ProfileTokens } from '../../src/utils/profile-records'

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

function makeTokens(id: string): ProfileTokens {
  return {
    idToken: `${id}-id`,
    accessToken: `${id}-access`,
    refreshToken: `${id}-refresh`,
    accountId: `${id}-account`,
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

function makeAuthData(id: string): AuthData {
  const title = id.charAt(0).toUpperCase() + id.slice(1)
  return {
    ...makeTokens(id),
    defaultOrganizationId: `${id}-org`,
    defaultOrganizationTitle: `${title} Org`,
    chatgptUserId: `${id}-chatgpt`,
    userId: `${id}-user`,
    subject: `${id}-subject`,
    email: `${id}@example.com`,
    planType: 'plus',
  }
}

test('ProfileTransferService exports saved profiles and skips missing tokens', async () => {
  const profiles = [
    makeProfile('profile-a', 'Alpha'),
    makeProfile('profile-b', 'Beta'),
  ]
  const tokens = makeTokens('profile-a')

  const service = new ProfileTransferService({
    listProfiles: async () => profiles,
    getActiveProfileId: async () => 'profile-a',
    getLastProfileId: async () => 'profile-b',
    readStoredTokens: async (profileId) =>
      profileId === 'profile-a' ? tokens : null,
    findDuplicateProfile: async () => undefined,
    replaceProfileAuth: async () => false,
    createProfile: async () => {
      throw new Error('not expected')
    },
    setActiveProfileId: async () => false,
    setLastProfileId: async () => undefined,
  })

  const result = await service.exportProfilesForTransfer()
  assert.equal(result.skipped, 1)
  assert.deepEqual(result.data, {
    format: 'codex-switch-profile-export',
    version: 1,
    exportedAt: result.data.exportedAt,
    activeProfileId: 'profile-a',
    lastProfileId: 'profile-b',
    profiles: [
      {
        profile: profiles[0],
        tokens,
      } satisfies ExportedProfileEntryV1,
    ],
  } satisfies ExportedSettingsV1)
})

test('ProfileTransferService imports valid profiles and remaps active state', async () => {
  const duplicate = makeProfile('existing-profile', 'Existing')
  const created = makeProfile('created-profile', 'Created')
  const createdCalls: Array<{ name: string; authData: AuthData }> = []
  const replacedCalls: Array<{ profileId: string; authData: AuthData }> = []
  const activeCalls: Array<string | undefined> = []
  const lastCalls: Array<string | undefined> = []

  const service = new ProfileTransferService({
    listProfiles: async () => [],
    getActiveProfileId: async () => undefined,
    getLastProfileId: async () => undefined,
    readStoredTokens: async () => null,
    findDuplicateProfile: async (authData) =>
      authData.email === 'duplicate@example.com' ? duplicate : undefined,
    replaceProfileAuth: async (profileId, authData) => {
      replacedCalls.push({ profileId, authData })
      return true
    },
    createProfile: async (name, authData) => {
      createdCalls.push({ name, authData })
      return created
    },
    setActiveProfileId: async (profileId) => {
      activeCalls.push(profileId)
      return true
    },
    setLastProfileId: async (profileId) => {
      lastCalls.push(profileId)
    },
  })

  const result = await service.importProfilesFromTransfer({
    format: 'codex-switch-profile-export',
    version: 1,
    activeProfileId: 'source-existing',
    lastProfileId: 'source-created',
    profiles: [
      {
        profile: {
          id: 'source-existing',
          name: 'Duplicate',
          email: 'duplicate@example.com',
          planType: 'plus',
          accountId: 'duplicate-account',
          defaultOrganizationId: 'duplicate-org',
          defaultOrganizationTitle: 'Duplicate Org',
          chatgptUserId: 'duplicate-chatgpt',
          userId: 'duplicate-user',
          subject: 'duplicate-subject',
        },
        tokens: makeTokens('duplicate'),
      },
      {
        profile: {
          id: 'source-invalid',
          name: 'Invalid',
          email: 'invalid@example.com',
          planType: 'plus',
        },
        tokens: {
          idToken: 'invalid-id',
          accessToken: 'invalid-access',
          refreshToken: 'invalid-refresh',
          authJson: {
            tokens: {
              id_token: 'mismatch-id',
              access_token: 'invalid-access',
              refresh_token: 'invalid-refresh',
            },
          },
        },
      },
      {
        profile: {
          id: 'source-created',
          name: 'Created',
          email: 'created@example.com',
          planType: 'plus',
          accountId: 'created-account',
          defaultOrganizationId: 'created-org',
          defaultOrganizationTitle: 'Created Org',
          chatgptUserId: 'created-chatgpt',
          userId: 'created-user',
          subject: 'created-subject',
        },
        tokens: makeTokens('created'),
      },
    ],
  })

  assert.deepEqual(result, {
    created: 1,
    updated: 1,
    skipped: 1,
  })
  assert.deepEqual(replacedCalls, [
    {
      profileId: 'existing-profile',
      authData: {
        ...makeAuthData('duplicate'),
        email: 'duplicate@example.com',
      },
    },
  ])
  assert.deepEqual(createdCalls, [
    {
      name: 'Created',
      authData: {
        ...makeAuthData('created'),
        email: 'created@example.com',
      },
    },
  ])
  assert.deepEqual(activeCalls, ['existing-profile'])
  assert.deepEqual(lastCalls, ['created-profile'])
})

test('ProfileTransferService rejects unsupported transfer payloads', async () => {
  const service = new ProfileTransferService({
    listProfiles: async () => [],
    getActiveProfileId: async () => undefined,
    getLastProfileId: async () => undefined,
    readStoredTokens: async () => null,
    findDuplicateProfile: async () => undefined,
    replaceProfileAuth: async () => false,
    createProfile: async () => makeProfile('created', 'Created'),
    setActiveProfileId: async () => false,
    setLastProfileId: async () => undefined,
  })

  await assert.rejects(
    () => service.importProfilesFromTransfer(null),
    /Invalid settings file format\./,
  )
  await assert.rejects(
    () =>
      service.importProfilesFromTransfer({
        format: 'unexpected',
        version: 1,
        profiles: [],
      }),
    /Unsupported settings file format\./,
  )
  await assert.rejects(
    () =>
      service.importProfilesFromTransfer({
        format: 'codex-switch-profile-export',
        version: 2,
        profiles: [],
      }),
    /Unsupported settings export version\./,
  )
  await assert.rejects(
    () =>
      service.importProfilesFromTransfer({
        format: 'codex-switch-profile-export',
        version: 1,
        profiles: {},
      }),
    /profiles must be an array\./,
  )
})
