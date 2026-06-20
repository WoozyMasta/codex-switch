/** Tests for profile-token-storage. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProfileTokens } from '../../src/utils/profile-records'
import {
  deleteStoredProfileTokens,
  readStoredProfileTokens,
  writeStoredProfileTokens,
} from '../../src/utils/profile-token-storage'

const tokens = {
  idToken: 'id',
  accessToken: 'access',
  refreshToken: 'refresh',
  accountId: 'acc',
  authJson: { tokens: { ok: true } },
} as ProfileTokens

test('stored token helpers select the remote backend when remoteFiles mode is enabled', async () => {
  const reads: string[] = []
  const writes: Array<[string, ProfileTokens]> = []
  const deletes: string[] = []

  assert.equal(
    await readStoredProfileTokens(
      {
        isRemoteFilesMode: true,
        readRemoteProfileTokens: (profileId) => {
          reads.push(profileId)
          return tokens
        },
        writeRemoteProfileTokens: (profileId, storedTokens) => {
          writes.push([profileId, storedTokens])
        },
        deleteRemoteProfileTokens: (profileId) => {
          deletes.push(profileId)
        },
        readLocalStoredTokens: async () => null,
        writeLocalStoredTokens: async () => undefined,
        deleteLocalStoredTokens: async () => undefined,
      },
      'remote',
    ),
    tokens,
  )

  await writeStoredProfileTokens(
    {
      isRemoteFilesMode: true,
      readRemoteProfileTokens: () => null,
      writeRemoteProfileTokens: (profileId, storedTokens) => {
        writes.push([profileId, storedTokens])
      },
      deleteRemoteProfileTokens: (profileId) => {
        deletes.push(profileId)
      },
      readLocalStoredTokens: async () => null,
      writeLocalStoredTokens: async () => undefined,
      deleteLocalStoredTokens: async () => undefined,
    },
    'remote',
    tokens,
  )

  await deleteStoredProfileTokens(
    {
      isRemoteFilesMode: true,
      readRemoteProfileTokens: () => null,
      writeRemoteProfileTokens: (profileId, storedTokens) => {
        writes.push([profileId, storedTokens])
      },
      deleteRemoteProfileTokens: (profileId) => {
        deletes.push(profileId)
      },
      readLocalStoredTokens: async () => null,
      writeLocalStoredTokens: async () => undefined,
      deleteLocalStoredTokens: async () => undefined,
    },
    'remote',
  )

  assert.deepEqual(reads, ['remote'])
  assert.deepEqual(writes, [['remote', tokens]])
  assert.deepEqual(deletes, ['remote'])
})

test('stored token helpers select the local backend outside remoteFiles mode', async () => {
  const reads: string[] = []
  const writes: Array<[string, ProfileTokens]> = []
  const deletes: string[] = []

  assert.equal(
    await readStoredProfileTokens(
      {
        isRemoteFilesMode: false,
        readRemoteProfileTokens: () => tokens,
        writeRemoteProfileTokens: () => undefined,
        deleteRemoteProfileTokens: () => undefined,
        readLocalStoredTokens: async (profileId) => {
          reads.push(profileId)
          return tokens
        },
        writeLocalStoredTokens: async () => undefined,
        deleteLocalStoredTokens: async () => undefined,
      },
      'local',
    ),
    tokens,
  )

  await writeStoredProfileTokens(
    {
      isRemoteFilesMode: false,
      readRemoteProfileTokens: () => null,
      writeRemoteProfileTokens: () => undefined,
      deleteRemoteProfileTokens: () => undefined,
      readLocalStoredTokens: async () => null,
      writeLocalStoredTokens: async (profileId, storedTokens) => {
        writes.push([profileId, storedTokens])
      },
      deleteLocalStoredTokens: async () => undefined,
    },
    'local',
    tokens,
  )

  await deleteStoredProfileTokens(
    {
      isRemoteFilesMode: false,
      readRemoteProfileTokens: () => null,
      writeRemoteProfileTokens: () => undefined,
      deleteRemoteProfileTokens: () => undefined,
      readLocalStoredTokens: async () => null,
      writeLocalStoredTokens: async () => undefined,
      deleteLocalStoredTokens: async (profileId) => {
        deletes.push(profileId)
      },
    },
    'local',
  )

  assert.deepEqual(reads, ['local'])
  assert.deepEqual(writes, [['local', tokens]])
  assert.deepEqual(deletes, ['local'])
})
