import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampPercent,
  normalizeRateLimitResponse,
} from '../../src/utils/rate-limit-normalizer'

test('clampPercent bounds and rounds values', () => {
  assert.equal(clampPercent(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(12.2), 12)
  assert.equal(clampPercent(101), 100)
})

test('normalizeRateLimitResponse prefers codex by-limit snapshots and supports camelCase and snake_case fields', () => {
  assert.equal(normalizeRateLimitResponse(null, 1_700_000_000), null)
  assert.equal(
    normalizeRateLimitResponse({ rateLimits: null }, 1_700_000_000),
    null,
  )
  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimitsByLimitId: {
          other: {
            primary: {
              usedPercent: 10,
              windowDurationMins: 300,
            },
          },
        },
        rateLimits: {
          primary: {
            usedPercent: 11,
            windowDurationMins: 300,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 11,
        remainingPercent: 89,
        resetsAt: null,
      },
      weekly: null,
    },
  )

  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimitsByLimitId: {
          codex: {
            primary: {
              used_percent: 12.2,
              window_minutes: 300,
              resets_in_seconds: 60,
            },
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: 1_700_000_060,
      },
      weekly: null,
    },
  )
})

test('normalizeRateLimitResponse falls back to rateLimits and rejects malformed windows', () => {
  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 41.6,
            windowDurationMins: 300,
            resetsAt: 1_700_000_500,
          },
          secondary: {
            usedPercent: 7,
            window_minutes: 10080,
            resets_at: 1_700_001_000,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 42,
        remainingPercent: 58,
        resetsAt: 1_700_000_500,
      },
      weekly: {
        usedPercent: 7,
        remainingPercent: 93,
        resetsAt: 1_700_001_000,
      },
    },
  )

  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          secondary: {
            usedPercent: 7,
            window_minutes: 10080,
            resets_at: 1_700_001_000,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: null,
      weekly: {
        usedPercent: 7,
        remainingPercent: 93,
        resetsAt: 1_700_001_000,
      },
    },
  )

  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 22,
            windowDurationMins: 300,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 22,
        remainingPercent: 78,
        resetsAt: null,
      },
      weekly: null,
    },
  )

  assert.equal(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: Infinity,
            windowDurationMins: 300,
            resetsAt: 1_700_000_500,
          },
        },
      },
      1_700_000_000,
    ),
    null,
  )

  assert.equal(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: 42,
        },
      },
      1_700_000_000,
    ),
    null,
  )

  assert.equal(
    normalizeRateLimitResponse(
      {
        rateLimitsByLimitId: {
          codex: {
            primary: 42,
          },
        },
      },
      1_700_000_000,
    ),
    null,
  )

  assert.equal(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 0,
          },
        },
      },
      1_700_000_000,
    ),
    null,
  )

  assert.equal(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 42,
          },
        },
      },
      1_700_000_000,
    ),
    null,
  )

  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resets_in_seconds: -1,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: null,
      },
      weekly: null,
    },
  )

  assert.deepEqual(
    normalizeRateLimitResponse(
      {
        rateLimits: {
          primary: {
            usedPercent: 18,
            windowDurationMins: 300,
            resets_in_seconds: 3_000_000_000,
          },
        },
      },
      1_700_000_000,
    ),
    {
      fiveHour: {
        usedPercent: 18,
        remainingPercent: 82,
        resetsAt: null,
      },
      weekly: null,
    },
  )
})
