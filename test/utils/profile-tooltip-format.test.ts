import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCommandUri,
  escapeLinkTitle,
  escapeTableCell,
  formatRateLimitCell,
  padTableCell,
} from '../../src/utils/profile-tooltip-format'

test('profile tooltip formatting helpers escape titles and table cells', () => {
  assert.equal(
    escapeLinkTitle('C:\\tmp\\"quoted"'),
    'C:\\\\tmp\\\\\\"quoted\\"',
  )
  assert.equal(
    escapeTableCell('Alpha\n$(zap) [open](command:evil) | <tag>'),
    'Alpha $\\(zap\\) \\[open\\]\\(command:evil\\) \\\\| &lt;tag&gt;',
  )
})

test('profile tooltip formatting helpers format command URIs and cells', () => {
  assert.equal(
    buildCommandUri('codex-switch.profile.activate', ['abc-123']),
    'command:codex-switch.profile.activate?%5B%22abc-123%22%5D',
  )
  assert.equal(formatRateLimitCell(null), '-')
  assert.equal(
    formatRateLimitCell({
      usedPercent: 42.2,
      remainingPercent: 57.8,
      resetsAt: null,
    }),
    '58%',
  )
  assert.equal(padTableCell('ok'), '&nbsp;ok&nbsp;')
})
