/** Tests for text-hash. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256Text } from '../../src/utils/text-hash'

test('sha256Text hashes text deterministically', () => {
  assert.equal(
    sha256Text('hello'),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  )
})
