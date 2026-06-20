/** Tests for auth-identity. */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildIdentitySnapshot,
  compareIdentitySnapshots,
} from '../../src/utils/auth-identity'

test('buildIdentitySnapshot normalizes identity fields', () => {
  assert.deepEqual(
    buildIdentitySnapshot({
      defaultOrganizationId: ' org-1 ',
      chatgptUserId: ' user-1 ',
      userId: ' u-1 ',
      subject: ' sub-1 ',
      accountId: ' acc-1 ',
      email: 'Unknown',
    }),
    {
      organizationId: 'org-1',
      chatgptUserId: 'user-1',
      userId: 'u-1',
      subject: 'sub-1',
      accountId: 'acc-1',
      email: '',
    },
  )

  assert.deepEqual(
    buildIdentitySnapshot({
      email: 'PERSON@example.com',
    }),
    {
      organizationId: '',
      chatgptUserId: '',
      userId: '',
      subject: '',
      accountId: '',
      email: 'person@example.com',
    },
  )
})

test('compareIdentitySnapshots distinguishes exact, different, and ambiguous matches', () => {
  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        chatgptUserId: 'user-1',
      },
      {
        organizationId: 'org-1',
        chatgptUserId: 'user-1',
      },
    ),
    'exact',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        chatgptUserId: 'user-1',
      },
      {
        organizationId: 'org-2',
        chatgptUserId: 'user-1',
      },
    ),
    'different',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        userId: 'user-1',
      },
      {
        organizationId: 'org-1',
        userId: 'user-2',
      },
    ),
    'different',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        chatgptUserId: 'user-1',
      },
      {
        organizationId: '',
        chatgptUserId: 'user-1',
      },
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'alice@example.com',
      }),
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'ALICE@example.com',
      }),
    ),
    'exact',
  )

  assert.equal(
    compareIdentitySnapshots(
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        accountId: 'acc-1',
      }),
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        accountId: ' acc-1 ',
      }),
    ),
    'exact',
  )

  assert.equal(
    compareIdentitySnapshots(
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'alice@example.com',
      }),
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-2',
        email: 'alice@example.com',
      }),
    ),
    'different',
  )

  assert.equal(
    compareIdentitySnapshots(
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'alice@example.com',
      }),
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        accountId: 'acc-1',
      }),
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'unknown',
      }),
      buildIdentitySnapshot({
        defaultOrganizationId: 'org-1',
        email: 'alice@example.com',
      }),
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        accountId: 'acc-1',
      },
      {
        organizationId: '',
        accountId: 'acc-1',
      },
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        accountId: 'acc-1',
      },
      {
        organizationId: 'org-1',
        accountId: 'acc-2',
      },
    ),
    'different',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        accountId: 'acc-1',
      },
      {
        organizationId: 'org-1',
        accountId: 'acc-1',
      },
    ),
    'exact',
  )

  assert.equal(compareIdentitySnapshots({}, {}), 'ambiguous')

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        userId: 'user-1',
      },
      {
        organizationId: 'org-1',
        userId: '',
      },
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
        accountId: 'acc-1',
      },
      {
        organizationId: 'org-1',
        accountId: '',
      },
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: 'org-1',
      },
      {
        organizationId: '',
      },
    ),
    'ambiguous',
  )

  assert.equal(
    compareIdentitySnapshots(
      {
        organizationId: '',
      },
      {
        organizationId: 'org-1',
      },
    ),
    'ambiguous',
  )
})
