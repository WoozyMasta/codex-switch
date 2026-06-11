import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProfileSummary } from '../../src/utils/profile-summary'

test('parseProfileSummary normalizes valid profile metadata', () => {
  assert.deepEqual(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: '  Alice  ',
      email: 'alice@example.com',
      planType: ' pro ',
      accountId: ' acc-1 ',
      defaultOrganizationId: ' org-1 ',
      defaultOrganizationTitle: ' Org ',
      chatgptUserId: ' user-1 ',
      userId: ' u-1 ',
      subject: ' sub-1 ',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
    }),
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      accountId: 'acc-1',
      defaultOrganizationId: 'org-1',
      defaultOrganizationTitle: 'Org',
      chatgptUserId: 'user-1',
      userId: 'u-1',
      subject: 'sub-1',
      createdAt: '2026-06-12T10:00:00.000Z',
      updatedAt: '2026-06-12T11:00:00.000Z',
    },
  )
})

test('parseProfileSummary rejects malformed ids and timestamps', () => {
  assert.equal(parseProfileSummary(null), null)

  assert.deepEqual(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      accountId: 123,
      defaultOrganizationId: 456,
      defaultOrganizationTitle: 789,
      chatgptUserId: 321,
      userId: 654,
      subject: 987,
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
    }),
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
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
      updatedAt: '2026-06-12T11:00:00.000Z',
    },
  )

  assert.equal(
    parseProfileSummary({
      id: 'not-a-uuid',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
    }),
    null,
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '   ',
      updatedAt: '2026-06-12T11:00:00Z',
    }),
    null,
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: 'invalid',
      updatedAt: '2026-06-12T11:00:00Z',
    }),
    null,
  )
})
