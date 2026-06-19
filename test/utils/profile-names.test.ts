import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDefaultProfileName } from '../../src/utils/profile-names'

test('buildDefaultProfileName prefers explicit name', () => {
  assert.equal(
    buildDefaultProfileName('  Work  ', 'alice@example.com', 'profile'),
    'Work',
  )
})

test('buildDefaultProfileName falls back to email local part and fallback', () => {
  assert.equal(
    buildDefaultProfileName(undefined, 'alice@example.com', 'profile'),
    'alice',
  )
  assert.equal(
    buildDefaultProfileName(undefined, 'Unknown', 'profile'),
    'profile',
  )
  assert.equal(
    buildDefaultProfileName(undefined, undefined, 'profile'),
    'profile',
  )
})
