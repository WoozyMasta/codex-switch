import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProfileSummary } from '../../src/types'
import type { ProfileTokens } from '../../src/utils/profile-records'
import { buildProfileAuthData } from '../../src/utils/profile-auth-data'

const profile = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  planType: 'pro',
  defaultOrganizationId: 'org-1',
  defaultOrganizationTitle: 'Org',
  chatgptUserId: 'user-1',
  userId: 'u-1',
  subject: 'sub-1',
  accountId: 'acc-1',
  createdAt: '2026-06-12T10:00:00.000Z',
  updatedAt: '2026-06-12T10:00:00.000Z',
} as ProfileSummary

const tokens = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  accountId: 'acc-2',
  authJson: { tokens: {} },
} as ProfileTokens

test('buildProfileAuthData merges tokens with profile fallbacks', () => {
  assert.deepEqual(
    buildProfileAuthData(profile, tokens, {
      idToken: ' id ',
      accessToken: ' access ',
      refreshToken: ' refresh ',
      email: ' alice@example.com ',
      planType: ' pro ',
      accountId: ' acc-3 ',
      defaultOrganizationId: ' org-2 ',
      defaultOrganizationTitle: ' Org 2 ',
      chatgptUserId: ' user-2 ',
      userId: ' u-2 ',
      subject: ' sub-2 ',
      authJson: { tokens: { ok: true } },
    }),
    {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      accountId: 'acc-3',
      defaultOrganizationId: 'org-2',
      defaultOrganizationTitle: 'Org 2',
      chatgptUserId: 'user-2',
      userId: 'u-2',
      subject: 'sub-2',
      email: 'alice@example.com',
      planType: 'pro',
      authJson: { tokens: { ok: true } },
    },
  )

  assert.deepEqual(
    buildProfileAuthData(profile, tokens, {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      email: 'alice@example.com',
      planType: 'pro',
    }),
    {
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      accountId: 'acc-2',
      defaultOrganizationId: 'org-1',
      defaultOrganizationTitle: 'Org',
      chatgptUserId: 'user-1',
      userId: 'u-1',
      subject: 'sub-1',
      email: 'alice@example.com',
      planType: 'pro',
      authJson: { tokens: {} },
    },
  )
})

test('buildProfileAuthData rejects missing required auth fields', () => {
  const blankProfile = {
    ...profile,
    email: ' ',
    planType: ' ',
  } as ProfileSummary

  assert.equal(
    buildProfileAuthData(
      blankProfile,
      {
        idToken: ' ',
        accessToken: ' ',
        refreshToken: ' ',
        authJson: { tokens: {} },
      } as ProfileTokens,
      {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    ),
    null,
  )

  assert.equal(
    buildProfileAuthData(
      profile,
      {
        idToken: ' ',
        accessToken: ' ',
        refreshToken: ' ',
        authJson: { tokens: {} },
      } as ProfileTokens,
      {
        email: 'alice@example.com',
        planType: 'pro',
      },
    ),
    null,
  )
})
