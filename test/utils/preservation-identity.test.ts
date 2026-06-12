import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import {
  buildStoredPreservationIdentity,
  matchesPreservationIdentityForProfile,
} from '../../src/utils/preservation-identity'

const baseProfile = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Alice',
  email: 'alice@example.com',
  planType: 'pro',
  createdAt: '2026-06-12T10:00:00.000Z',
  updatedAt: '2026-06-12T10:00:00.000Z',
} as ProfileSummary

const baseAuth = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
} as AuthData

test('buildStoredPreservationIdentity prefers stored values and falls back to profile values', () => {
  assert.deepEqual(buildStoredPreservationIdentity(baseProfile, null), {
    organizationId: '',
    chatgptUserId: '',
    userId: '',
    subject: '',
    accountId: '',
    email: '',
  })
  assert.deepEqual(
    buildStoredPreservationIdentity(baseProfile, {
      ...baseAuth,
      defaultOrganizationId: ' org-1 ',
      chatgptUserId: ' user-1 ',
      userId: ' u-1 ',
      subject: ' sub-1 ',
    }),
    {
      organizationId: 'org-1',
      chatgptUserId: 'user-1',
      userId: 'u-1',
      subject: 'sub-1',
      accountId: '',
      email: '',
    },
  )

  assert.deepEqual(
    buildStoredPreservationIdentity(
      {
        ...baseProfile,
        defaultOrganizationId: ' org-2 ',
        chatgptUserId: ' user-2 ',
        userId: ' u-2 ',
        subject: ' sub-2 ',
      },
      {
        ...baseAuth,
        defaultOrganizationId: '   ',
        chatgptUserId: '',
        userId: ' ',
        subject: '\t',
      },
    ),
    {
      organizationId: 'org-2',
      chatgptUserId: 'user-2',
      userId: 'u-2',
      subject: 'sub-2',
      accountId: '',
      email: '',
    },
  )
})

test('matchesPreservationIdentityForProfile requires exact identity match', () => {
  assert.equal(
    matchesPreservationIdentityForProfile(baseProfile, baseAuth, null),
    false,
  )

  assert.equal(
    matchesPreservationIdentityForProfile(
      {
        ...baseProfile,
        defaultOrganizationId: ' org-1 ',
        chatgptUserId: ' user-1 ',
      },
      {
        ...baseAuth,
        defaultOrganizationId: 'org-1',
        chatgptUserId: 'user-1',
      },
      null,
    ),
    true,
  )

  assert.equal(
    matchesPreservationIdentityForProfile(
      {
        ...baseProfile,
        defaultOrganizationId: ' org-1 ',
        chatgptUserId: ' user-1 ',
      },
      {
        ...baseAuth,
        defaultOrganizationId: 'org-2',
        chatgptUserId: 'user-1',
      },
      null,
    ),
    false,
  )

  assert.equal(
    matchesPreservationIdentityForProfile(
      {
        ...baseProfile,
        userId: ' u-1 ',
      },
      {
        ...baseAuth,
        userId: 'u-1',
      },
      null,
    ),
    true,
  )
})
