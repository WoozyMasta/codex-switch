/** Tests for profile-records. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData } from '../../src/types'
import {
  buildProfileSummaryFromAuth,
  buildProfileTokensFromAuth,
} from '../../src/utils/profile-records'

const baseAuth = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  email: 'alice@example.com',
  planType: 'pro',
} as AuthData

test('buildProfileSummaryFromAuth and buildProfileTokensFromAuth copy auth fields', () => {
  assert.deepEqual(
    buildProfileSummaryFromAuth(
      'id-1',
      'Alice',
      baseAuth,
      '2026-06-12T10:00:00.000Z',
    ),
    {
      id: 'id-1',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      accountId: undefined,
      defaultOrganizationId: undefined,
      defaultOrganizationTitle: undefined,
      chatgptUserId: undefined,
      userId: undefined,
      subject: undefined,
      createdAt: '2026-06-12T10:00:00.000Z',
      updatedAt: '2026-06-12T10:00:00.000Z',
    },
  )

  assert.deepEqual(buildProfileTokensFromAuth(baseAuth), {
    idToken: 'id',
    accessToken: 'access',
    refreshToken: 'refresh',
    accountId: undefined,
    authJson: undefined,
  })
})
