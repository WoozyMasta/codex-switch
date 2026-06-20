/** Tests for markdown. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeMarkdown } from '../../src/utils/markdown'

test('escapeMarkdown escapes markdown and html-significant characters', () => {
  assert.equal(
    escapeMarkdown('a*b_[c](d) <e> & f |g`h'),
    'a\\*b\\_\\[c\\]\\(d\\) &lt;e&gt; &amp; f \\|g\\`h',
  )
})

test('escapeMarkdown preserves plain text', () => {
  assert.equal(escapeMarkdown('plain text'), 'plain text')
})
