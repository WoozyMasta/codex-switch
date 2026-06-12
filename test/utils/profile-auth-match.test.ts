import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthData, ProfileSummary } from '../../src/types'
import { findMatchingProfileIdForAuth } from '../../src/utils/profile-auth-match'

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
} as AuthData

test('findMatchingProfileIdForAuth returns the first exact identity match', () => {
  assert.equal(findMatchingProfileIdForAuth([profile], auth), profile.id)
  assert.equal(findMatchingProfileIdForAuth([], auth), undefined)
})
