/** Tests for profile-tooltip-format. */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProfileTooltipActionsFooter,
  buildProfileTooltipHomeSection,
  buildProfileTooltipRow,
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

test('profile tooltip formatting helpers build profile rows', () => {
  assert.equal(
    buildProfileTooltipRow({
      profileId: 'abc-123',
      name: 'Alpha\n$(zap) [open](command:evil)',
      plan: 'PRO',
      fiveHour: '58%',
      fiveHourReset: '10:30',
      weekly: '1%',
      weeklyReset: '-',
      refresh: '4m/11m',
      email: 'line1\r\nline2@example.com',
      isActive: true,
      includePlan: true,
      includeFiveHour: true,
      includeWeekly: true,
    }),
    `| &nbsp;$(check)&nbsp; | &nbsp;[**Alpha $\\(zap\\) \\[open\\]\\(command:evil\\)**](command:codex-switch.profile.activate?%5B%22abc-123%22%5D "line1\r\nline2@example.com")&nbsp; | &nbsp;PRO&nbsp; | &nbsp;58%&nbsp; | &nbsp;10:30&nbsp; | &nbsp;1%&nbsp; | &nbsp;-&nbsp; | &nbsp;4m/11m&nbsp; |\n`,
  )
  assert.equal(
    buildProfileTooltipRow({
      profileId: 'abc-123',
      name: 'Beta',
      plan: 'PLUS',
      fiveHour: '-',
      fiveHourReset: '-',
      weekly: '-',
      weeklyReset: '-',
      refresh: '',
      email: 'Unknown',
      isActive: false,
      includePlan: false,
      includeFiveHour: false,
      includeWeekly: false,
    }),
    `| &nbsp;&nbsp; | &nbsp;[Beta](command:codex-switch.profile.activate?%5B%22abc-123%22%5D "Unknown")&nbsp; | &nbsp;&nbsp; |\n`,
  )
})

test('profile tooltip formatting helpers build home and footer sections', () => {
  assert.equal(
    buildProfileTooltipHomeSection(
      'Home\n$(alert) [go](command:evil)',
      'C:\\tmp\\home\n$(beep)\\[1]',
    ),
    `---\n\nActive home: **Home\n$\\(alert\\) \\[go\\]\\(command:evil\\)**\n\nPath: C:\\\\tmp\\\\home\n$\\(beep\\)\\\\\\[1\\]\n\n`,
  )
  assert.equal(
    buildProfileTooltipActionsFooter('Manage profiles', 'Refresh limits'),
    `---\n\n[Manage profiles](command:codex-switch.profile.manage "Manage profiles") · [Refresh limits](command:codex-switch.profile.refresh "Refresh limits")\n\n`,
  )
})
