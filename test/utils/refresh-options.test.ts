import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  MAX_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  MIN_ENABLED_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  deriveInitialFailureRetrySeconds,
  deriveMaxFailureBackoffSeconds,
  derivePollIntervalSeconds,
  deriveStartupJitterSeconds,
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
  assert.equal(DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS, 900)
  assert.equal(MIN_ENABLED_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS, 30)
  assert.equal(MAX_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS, 43200)

  assert.equal(
    normalizeRateLimitAutoRefreshIntervalSeconds(undefined),
    DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
  assert.equal(
    normalizeRateLimitAutoRefreshIntervalSeconds(Number.NaN),
    DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
  assert.equal(
    normalizeRateLimitAutoRefreshIntervalSeconds('nope' as unknown),
    DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
  // 0 and negative values disable automatic maintenance.
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(0), 0)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(-10), 0)
  // Positive values below the minimum normalize up to 30.
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(1), 30)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(29), 30)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(30), 30)
  // In-range values pass through; values above the maximum clamp to 43200.
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(900), 900)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(43200), 43200)
  assert.equal(normalizeRateLimitAutoRefreshIntervalSeconds(100000), 43200)
})

test('derived scheduling intervals are deterministic', () => {
  // poll interval = clamp(T / 6, 10s, 2min)
  assert.equal(derivePollIntervalSeconds(30), 10)
  assert.equal(derivePollIntervalSeconds(15 * 60), 120)
  assert.equal(derivePollIntervalSeconds(3 * 60 * 60), 120)
  assert.equal(derivePollIntervalSeconds(360), 60)

  // initial retry = clamp(T / 4, 30s, 15min)
  assert.equal(deriveInitialFailureRetrySeconds(30), 30)
  assert.equal(deriveInitialFailureRetrySeconds(2000), 500)
  assert.equal(deriveInitialFailureRetrySeconds(43200), 900)

  // max backoff caps at the user interval
  assert.equal(deriveMaxFailureBackoffSeconds(900), 900)

  // startup jitter uses an injected random source in [0, 1)
  assert.equal(
    deriveStartupJitterSeconds(15 * 60, () => 0),
    0,
  )
  assert.equal(
    deriveStartupJitterSeconds(15 * 60, () => 0.5),
    7.5,
  )
  assert.equal(
    deriveStartupJitterSeconds(30, () => 1),
    10,
  )
})
