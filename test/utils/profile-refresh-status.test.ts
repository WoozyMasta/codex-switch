import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatProfileRefreshCells,
  formatProfileRefreshLabel,
  formatRelativeDuration,
  type RefreshLabelTranslate,
} from '../../src/utils/profile-refresh-status'

const translate: RefreshLabelTranslate = (message, ...args) => {
  let result = message
  args.forEach((arg, index) => {
    result = result.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg))
  })
  return result
}

test('formatRelativeDuration renders compact seconds, minutes, and hours', () => {
  assert.equal(formatRelativeDuration(0), '0s')
  assert.equal(formatRelativeDuration(-5000), '0s')
  assert.equal(formatRelativeDuration(30_000), '30s')
  assert.equal(formatRelativeDuration(59_000), '59s')
  assert.equal(formatRelativeDuration(60_000), '1m')
  assert.equal(formatRelativeDuration(90_000), '1m')
  assert.equal(formatRelativeDuration(59 * 60_000), '59m')
  assert.equal(formatRelativeDuration(60 * 60_000), '1h')
  assert.equal(formatRelativeDuration(150 * 60_000), '2h')
})

test('formatProfileRefreshLabel shows an updating state during an active check', () => {
  assert.equal(
    formatProfileRefreshLabel(
      { isRefreshing: true, lastSuccessAt: 1000 },
      { now: 5000, autoRefreshEnabled: true, translate },
    ),
    'Updating now…',
  )
})

test('formatProfileRefreshLabel shows cached age and next refresh when enabled', () => {
  const now = 1_000_000
  assert.equal(
    formatProfileRefreshLabel(
      {
        isRefreshing: false,
        lastSuccessAt: now - 4 * 60_000,
        nextDueAt: now + 11 * 60_000,
      },
      { now, autoRefreshEnabled: true, translate },
    ),
    'Updated 4m ago · Next refresh in 11m',
  )
})

test('formatProfileRefreshLabel prefers retry timing after a failure', () => {
  const now = 1_000_000
  assert.equal(
    formatProfileRefreshLabel(
      {
        isRefreshing: false,
        lastSuccessAt: now - 19 * 60_000,
        nextDueAt: now + 60_000,
        nextRetryAt: now + 2 * 60_000,
      },
      { now, autoRefreshEnabled: true, translate },
    ),
    'Updated 19m ago · Retry in 2m',
  )
})

test('formatProfileRefreshLabel falls back to next refresh when a retry is already due', () => {
  const now = 1_000_000
  assert.equal(
    formatProfileRefreshLabel(
      {
        isRefreshing: false,
        lastSuccessAt: now - 60_000,
        nextDueAt: now + 5 * 60_000,
        nextRetryAt: now - 1000,
      },
      { now, autoRefreshEnabled: true, translate },
    ),
    'Updated 1m ago · Next refresh in 5m',
  )
})

test('formatProfileRefreshLabel shows the disabled state when automatic refresh is off', () => {
  const now = 1_000_000
  assert.equal(
    formatProfileRefreshLabel(
      { isRefreshing: false, lastSuccessAt: now - 60_000 },
      { now, autoRefreshEnabled: false, translate },
    ),
    'Updated 1m ago · Automatic refresh disabled',
  )
  assert.equal(
    formatProfileRefreshLabel(
      { isRefreshing: false },
      { now, autoRefreshEnabled: false, translate },
    ),
    'Automatic refresh disabled',
  )
})

test('formatProfileRefreshLabel omits timing when no successful result exists', () => {
  const now = 1_000_000
  assert.equal(
    formatProfileRefreshLabel(
      { isRefreshing: false },
      { now, autoRefreshEnabled: true, translate },
    ),
    '',
  )
})

test('formatProfileRefreshCells returns ellipsis while refreshing', () => {
  assert.deepEqual(
    formatProfileRefreshCells(
      { isRefreshing: true, lastSuccessAt: 1000 },
      { now: 5000, autoRefreshEnabled: true, translate },
    ),
    { updated: '…', next: '' },
  )
})

test('formatProfileRefreshCells returns compact durations when auto-refresh is enabled', () => {
  const now = 1_000_000
  assert.deepEqual(
    formatProfileRefreshCells(
      {
        isRefreshing: false,
        lastSuccessAt: now - 4 * 60_000,
        nextDueAt: now + 11 * 60_000,
      },
      { now, autoRefreshEnabled: true, translate },
    ),
    { updated: '4m', next: '11m' },
  )
})

test('formatProfileRefreshCells omits next when auto-refresh is disabled', () => {
  const now = 1_000_000
  assert.deepEqual(
    formatProfileRefreshCells(
      { isRefreshing: false, lastSuccessAt: now - 60_000 },
      { now, autoRefreshEnabled: false, translate },
    ),
    { updated: '1m', next: '' },
  )
})

test('formatProfileRefreshCells uses retry time in next when pending', () => {
  const now = 1_000_000
  assert.deepEqual(
    formatProfileRefreshCells(
      {
        isRefreshing: false,
        lastSuccessAt: now - 19 * 60_000,
        nextDueAt: now + 60_000,
        nextRetryAt: now + 2 * 60_000,
      },
      { now, autoRefreshEnabled: true, translate },
    ),
    { updated: '19m', next: '2m' },
  )
})

test('formatProfileRefreshCells returns empty strings when no data', () => {
  const now = 1_000_000
  assert.deepEqual(
    formatProfileRefreshCells(
      { isRefreshing: false },
      { now, autoRefreshEnabled: true, translate },
    ),
    { updated: '', next: '' },
  )
})
