import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProfileResetTime } from '../../src/utils/profile-reset-time'

function expectedTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function expectedDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
  }).format(date)
}

test('formatProfileResetTime returns the time for the same local day', () => {
  const now = new Date(2026, 5, 19, 12, 0, 0)
  const reset = new Date(2026, 5, 19, 10, 30, 0)

  assert.equal(
    formatProfileResetTime(reset.getTime() / 1000, now),
    expectedTime(reset),
  )
})

test('formatProfileResetTime prefixes the weekday for a different local day', () => {
  const now = new Date(2026, 5, 19, 12, 0, 0)
  const reset = new Date(2026, 5, 20, 10, 30, 0)

  assert.equal(
    formatProfileResetTime(reset.getTime() / 1000, now),
    `${expectedDay(reset)} ${expectedTime(reset)}`,
  )
})

test('formatProfileResetTime rejects invalid timestamps', () => {
  assert.equal(formatProfileResetTime(null), null)
  assert.equal(formatProfileResetTime(undefined), null)
  assert.equal(formatProfileResetTime(Number.NaN), null)
  assert.equal(formatProfileResetTime(Number.POSITIVE_INFINITY), null)
  assert.equal(formatProfileResetTime(Number.MAX_SAFE_INTEGER), null)
})
