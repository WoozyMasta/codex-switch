import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  mergeRefreshOptions,
  normalizeRateLimitAutoRefreshIntervalSeconds,
} from '../../src/utils/refresh-options'

test('mergeRefreshOptions merges forced refresh and active-only flags conservatively', () => {
  assert.deepEqual(
    mergeRefreshOptions(null, {
      forceRateLimitRefresh: true,
      refreshActiveRateLimitOnly: false,
    }),
    {
      forceRateLimitRefresh: true,
      refreshActiveRateLimitOnly: false,
    },
  )

  assert.deepEqual(
    mergeRefreshOptions(
      {
        forceRateLimitRefresh: true,
        refreshActiveRateLimitOnly: true,
      },
      {
        refreshActiveRateLimitOnly: true,
      },
    ),
    {
      forceRateLimitRefresh: true,
      refreshActiveRateLimitOnly: true,
    },
  )

  assert.deepEqual(
    mergeRefreshOptions(
      {
        forceRateLimitRefresh: false,
        refreshActiveRateLimitOnly: false,
      },
      {
        forceRateLimitRefresh: false,
        refreshActiveRateLimitOnly: false,
      },
    ),
    {
      forceRateLimitRefresh: false,
      refreshActiveRateLimitOnly: false,
    },
  )

  assert.deepEqual(
    mergeRefreshOptions(
      {
        forceRateLimitRefresh: true,
        refreshActiveRateLimitOnly: true,
      },
      {
        forceRateLimitRefresh: true,
        refreshActiveRateLimitOnly: true,
      },
    ),
    {
      forceRateLimitRefresh: true,
      refreshActiveRateLimitOnly: true,
    },
  )

  assert.deepEqual(
    mergeRefreshOptions(
      {
        forceRateLimitRefresh: false,
        refreshActiveRateLimitOnly: false,
      },
      {
        forceRateLimitRefresh: true,
        refreshActiveRateLimitOnly: true,
      },
    ),
    {
      forceRateLimitRefresh: true,
      refreshActiveRateLimitOnly: false,
    },
  )
})

test('normalizeRateLimitAutoRefreshIntervalSeconds clamps valid values and falls back for invalid ones', () => {
  assert.equal(
    normalizeRateLimitAutoRefreshIntervalSeconds(undefined),
    DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
  assert.equal(
    normalizeRateLimitAutoRefreshIntervalSeconds(Number.NaN),
    DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(0), 0)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(3), 5)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(12), 12)
})
