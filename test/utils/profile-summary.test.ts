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
      rateLimits: {
        fiveHour: {
          usedPercent: 45.5,
          remainingPercent: 54.5,
          resetsAt: 1_700_000_000,
        },
        weekly: null,
      },
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
      rateLimits: {
        fiveHour: {
          usedPercent: 45.5,
          remainingPercent: 54.5,
          resetsAt: 1_700_000_000,
        },
        weekly: null,
      },
    },
  )
})

test('parseProfileSummary accepts rate limit windows without reset timestamps', () => {
  assert.deepEqual(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: {
        fiveHour: {
          usedPercent: 12.5,
          remainingPercent: 87.5,
        },
        weekly: {
          usedPercent: 10,
          remainingPercent: 90,
          resetsAt: null,
        },
      },
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
      rateLimits: {
        fiveHour: {
          usedPercent: 12.5,
          remainingPercent: 87.5,
          resetsAt: undefined,
        },
        weekly: {
          usedPercent: 10,
          remainingPercent: 90,
          resetsAt: undefined,
        },
      },
    },
  )
})

test('parseProfileSummary rejects malformed ids and timestamps', () => {
  assert.equal(parseProfileSummary(null), null)

  assert.equal(
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
      rateLimits: {
        fiveHour: {
          usedPercent: 10,
          remainingPercent: 'invalid',
        },
        weekly: null,
      },
    }),
    null,
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: 'invalid',
    }),
    null,
  )

  assert.equal(
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
      rateLimits: {
        fiveHour: {
          usedPercent: 10,
          remainingPercent: 'invalid',
        },
        weekly: null,
      },
    }),
    null,
  )

  assert.deepEqual(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: null,
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
      rateLimits: null,
    },
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: {
        fiveHour: 0,
        weekly: null,
      },
    }),
    null,
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: {
        fiveHour: {
          usedPercent: 10,
          remainingPercent: 90,
          resetsAt: 'invalid',
        },
        weekly: null,
      },
    }),
    null,
  )

  assert.equal(
    parseProfileSummary({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      planType: 'pro',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T11:00:00Z',
      rateLimits: {
        fiveHour: {
          usedPercent: 10,
          remainingPercent: 90,
          resetsAt: Number.POSITIVE_INFINITY,
        },
        weekly: null,
      },
    }),
    null,
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
      id: '../../profiles.json',
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
