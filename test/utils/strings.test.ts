import assert from 'node:assert/strict'
import test from 'node:test'
import { asOptionalString, firstDefinedString } from '../../src/utils/strings'

test('asOptionalString trims non-empty strings and drops empty values', () => {
  assert.equal(asOptionalString('  hello  '), 'hello')
  assert.equal(asOptionalString('   '), undefined)
  assert.equal(asOptionalString(123), undefined)
})

test('firstDefinedString returns the first non-empty string', () => {
  assert.equal(firstDefinedString(undefined, '', 'alpha', 'beta'), 'alpha')
  assert.equal(firstDefinedString(undefined, undefined), undefined)
})
