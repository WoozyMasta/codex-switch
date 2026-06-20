/** Tests for import-entry. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseImportEntry } from '../../src/utils/import-entry'

test('parseImportEntry normalizes a valid import entry', () => {
  assert.deepEqual(
    parseImportEntry({
      profile: {
        id: ' 123e4567-e89b-12d3-a456-426614174000 ',
        name: '  Alice Example  ',
        email: 'alice@example.com',
        planType: ' pro ',
        accountId: ' acc-1 ',
        defaultOrganizationId: ' org-1 ',
        defaultOrganizationTitle: ' Org ',
        chatgptUserId: ' user-1 ',
        userId: ' u-1 ',
        subject: ' sub-1 ',
      },
      tokens: {
        idToken: ' id ',
        accessToken: ' access ',
        refreshToken: ' refresh ',
        accountId: ' acc-1 ',
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
            account_id: 'acc-1',
          },
        },
      },
    }),
    {
      sourceProfileId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice Example',
      authData: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
        accountId: 'acc-1',
        defaultOrganizationId: 'org-1',
        defaultOrganizationTitle: 'Org',
        chatgptUserId: 'user-1',
        userId: 'u-1',
        subject: 'sub-1',
        email: 'alice@example.com',
        planType: 'pro',
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
            account_id: 'acc-1',
          },
        },
      },
    },
  )
})

test('parseImportEntry rejects malformed or inconsistent entries', () => {
  assert.equal(parseImportEntry(null), null)
  assert.equal(parseImportEntry({}), null)
  assert.equal(
    parseImportEntry({
      profile: {},
      tokens: {},
    }),
    null,
  )
  assert.equal(
    parseImportEntry({
      profile: {
        email: 'alice@example.com',
        accountId: 'acc-1',
      },
      tokens: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
        authJson: {
          tokens: {
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
            account_id: 'different',
          },
        },
      },
    }),
    null,
  )
  assert.equal(
    parseImportEntry({
      profile: {},
      tokens: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    })?.name,
    'profile',
  )
  assert.equal(
    parseImportEntry({
      profile: {
        email: 'alice@example.com',
      },
      tokens: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    })?.name,
    'alice',
  )
  assert.equal(
    parseImportEntry({
      profile: {
        name: '   ',
      },
      tokens: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    })?.name,
    'profile',
  )
})
