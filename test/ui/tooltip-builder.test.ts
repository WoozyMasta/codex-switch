import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProfileSummary, ResolvedCodexHome } from '../../src/types'
import { createProfileTooltip } from '../../src/ui/tooltip-builder'
import { escapeMarkdown } from '../../src/utils/markdown'

function makeProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Alice * [x] | <tag>',
    email: 'evil"quote\\slash@example.com',
    planType: 'pro',
    createdAt: '2026-06-19T10:00:00.000Z',
    updatedAt: '2026-06-19T10:00:00.000Z',
    rateLimits: {
      fiveHour: {
        usedPercent: 42.2,
        remainingPercent: 57.8,
        resetsAt: 1_700_000_000,
      },
      weekly: {
        usedPercent: 99.4,
        remainingPercent: 0.6,
        resetsAt: null,
      },
    },
    ...overrides,
  }
}

function makeHome(
  overrides: Partial<ResolvedCodexHome> = {},
): ResolvedCodexHome {
  return {
    id: 'home-1',
    name: 'Home * [A] | <B>',
    fsPath: 'C:\\tmp\\home_[1]\\<x>',
    envValue: 'C:\\tmp\\home_[1]',
    authPath: 'C:\\tmp\\home_[1]\\auth.json',
    source: 'default',
    isDefault: true,
    usesPerHomeState: false,
    ...overrides,
  }
}

test('createProfileTooltip restricts commands and escapes profile markup', () => {
  const profile = makeProfile()
  const tooltip = createProfileTooltip(profile, [profile], makeHome())

  assert.equal(tooltip.supportThemeIcons, true)
  assert.equal(tooltip.supportHtml, true)
  assert.deepEqual(tooltip.isTrusted, {
    enabledCommands: [
      'codex-switch.profile.manage',
      'codex-switch.profile.activate',
      'codex-switch.profile.refresh',
    ],
  })
  assert.match(tooltip.value, /Codex accounts/)
  assert.match(tooltip.value, /Manage profiles/)
  assert.match(tooltip.value, /Refresh limits/)
  assert.ok(
    tooltip.value.includes(
      `${escapeMarkdown(profile.name).replace(/\|/g, '\\|')}`,
    ),
  )
  assert.ok(tooltip.value.includes('evil\\"quote\\\\slash@example.com'))
  assert.ok(tooltip.value.includes(escapeMarkdown('Home * [A] | <B>')))
  assert.ok(tooltip.value.includes(escapeMarkdown('C:\\tmp\\home_[1]\\<x>')))
  assert.match(tooltip.value, /\$\(check\)/)
  assert.match(tooltip.value, /58%/)
  assert.ok(tooltip.value.includes('&nbsp;1%&nbsp;'))
})

test('createProfileTooltip renders the empty-state copy', () => {
  const tooltip = createProfileTooltip(null, [])

  assert.match(tooltip.value, /Codex accounts/)
  assert.match(tooltip.value, /No profiles yet\./)
  assert.match(tooltip.value, /Manage profiles/)
  assert.match(tooltip.value, /Refresh limits/)
})
