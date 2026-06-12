import assert from 'node:assert/strict'
import test from 'node:test'
import { asOptionalString } from '../../src/utils/strings'

test('asOptionalString trims non-empty strings and drops empty values', () => {
  assert.equal(asOptionalString('  hello  '), 'hello')
  assert.equal(asOptionalString('   '), undefined)
  assert.equal(asOptionalString(123), undefined)
})
