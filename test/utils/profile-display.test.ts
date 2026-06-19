import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProfileMetaDisplay,
  formatProfilePlanDisplay,
  formatProfileRateLimitsDisplay,
} from '../../src/utils/profile-display'
import type { ProfileRateLimits } from '../../src/types'

test('formatProfilePlanDisplay returns uppercase plan or unknown label', () => {
  assert.equal(formatProfilePlanDisplay('pro'), 'PRO')
  assert.equal(formatProfilePlanDisplay('', 'Unknown'), 'Unknown')
  assert.equal(formatProfilePlanDisplay('unknown', 'unknown'), 'unknown')
})

test('formatProfileRateLimitsDisplay renders remaining percentages', () => {
  const rateLimits: ProfileRateLimits = {
    fiveHour: {
      usedPercent: 42.2,
      remainingPercent: 57.8,
      resetsAt: null,
    },
    weekly: {
      usedPercent: 99.4,
      remainingPercent: 0.6,
      resetsAt: null,
    },
  }

  assert.equal(
    formatProfileRateLimitsDisplay(rateLimits, {
      unknown: 'Unknown',
      fiveHour: '5h',
      weekly: 'Weekly',
    }),
    '5h 58% • Weekly 1%',
  )
  assert.equal(formatProfileRateLimitsDisplay(null), null)
})

test('buildProfileMetaDisplay combines plan and limits labels', () => {
  assert.equal(
    buildProfileMetaDisplay('pro', {
      fiveHour: {
        usedPercent: 42.2,
        remainingPercent: 57.8,
        resetsAt: null,
      },
      weekly: null,
    }),
    'PRO • 5h 58%',
  )
})
