import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProfileEmailDescription } from '../../src/utils/profile-email'

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
