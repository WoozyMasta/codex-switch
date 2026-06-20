/** Tests for profile-email. */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatProfileEmailDescription,
  formatProfileEmailLabel,
} from '../../src/utils/profile-email'

test('formatProfileEmailDescription omits unknown emails', () => {
  assert.equal(formatProfileEmailDescription(undefined), undefined)
  assert.equal(formatProfileEmailDescription('Unknown'), undefined)
})

test('formatProfileEmailDescription preserves real emails', () => {
  assert.equal(
    formatProfileEmailDescription('alice@example.com'),
    'alice@example.com',
  )
})

test('formatProfileEmailLabel falls back to unknown label', () => {
  assert.equal(formatProfileEmailLabel(undefined, 'Unknown'), 'Unknown')
  assert.equal(formatProfileEmailLabel('Unknown', 'Unknown'), 'Unknown')
  assert.equal(
    formatProfileEmailLabel('alice@example.com', 'Unknown'),
    'alice@example.com',
  )
})
