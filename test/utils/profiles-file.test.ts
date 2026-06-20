/** Tests for profiles-file. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProfilesFile } from '../../src/utils/profiles-file'

test('parseProfilesFile accepts legacy and current profile file shapes', () => {
  assert.deepEqual(
    parseProfilesFile(
      JSON.stringify([
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Alice',
          email: 'alice@example.com',
          planType: 'pro',
          createdAt: '2026-06-12T10:00:00Z',
          updatedAt: '2026-06-12T11:00:00Z',
        },
      ]),
    ),
    {
      version: 1,
      profiles: [
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
          rateLimits: undefined,
        },
      ],
    },
  )

  assert.deepEqual(
    parseProfilesFile(
      JSON.stringify({
        profiles: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Alice',
            email: 'alice@example.com',
            planType: 'pro',
            createdAt: '2026-06-12T10:00:00Z',
            updatedAt: '2026-06-12T11:00:00Z',
          },
        ],
      }),
    ),
    {
      version: 1,
      profiles: [
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
          rateLimits: undefined,
        },
      ],
    },
  )

  assert.deepEqual(
    parseProfilesFile(
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Alice',
            email: 'alice@example.com',
            planType: 'pro',
            createdAt: '2026-06-12T10:00:00Z',
            updatedAt: '2026-06-12T11:00:00Z',
          },
        ],
      }),
    ),
    {
      version: 1,
      profiles: [
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
          rateLimits: undefined,
        },
      ],
    },
  )
})

test('parseProfilesFile rejects malformed content that cannot be normalized', () => {
  assert.equal(parseProfilesFile('not-json'), null)
  assert.equal(parseProfilesFile(JSON.stringify('hello')), null)
  assert.equal(parseProfilesFile(JSON.stringify(null)), null)
  assert.equal(parseProfilesFile(JSON.stringify({ foo: 1 })), null)
  assert.equal(
    parseProfilesFile(
      JSON.stringify([
        {
          id: 'not-a-uuid',
          name: 'Alice',
          email: 'alice@example.com',
          planType: 'pro',
          createdAt: '2026-06-12T10:00:00Z',
          updatedAt: '2026-06-12T11:00:00Z',
        },
      ]),
    ),
    null,
  )
  assert.equal(
    parseProfilesFile(
      JSON.stringify({
        profiles: [
          {
            id: 'not-a-uuid',
            name: 'Alice',
            email: 'alice@example.com',
            planType: 'pro',
            createdAt: '2026-06-12T10:00:00Z',
            updatedAt: '2026-06-12T11:00:00Z',
          },
        ],
      }),
    ),
    null,
  )
  assert.equal(
    parseProfilesFile(
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: 'not-a-uuid',
            name: 'Alice',
            email: 'alice@example.com',
            planType: 'pro',
            createdAt: '2026-06-12T10:00:00Z',
            updatedAt: '2026-06-12T11:00:00Z',
          },
        ],
      }),
    ),
    null,
  )
  assert.equal(
    parseProfilesFile(
      JSON.stringify({
        version: 2,
        profiles: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Alice',
            email: 'alice@example.com',
            planType: 'pro',
            createdAt: '2026-06-12T10:00:00Z',
            updatedAt: '2026-06-12T11:00:00Z',
          },
        ],
      }),
    ),
    null,
  )
})
