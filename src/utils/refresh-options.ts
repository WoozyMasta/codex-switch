export interface RefreshProfileUiOptions {
  forceRateLimitRefresh?: boolean
  refreshActiveRateLimitOnly?: boolean
}

export const DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS = 900
export const MIN_ENABLED_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS = 30
export const MAX_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS = 43200

export function mergeRefreshOptions(
  current: RefreshProfileUiOptions | null,
  next: RefreshProfileUiOptions,
): RefreshProfileUiOptions {
  if (!current) {
    return next
  }

  return {
    forceRateLimitRefresh:
      current.forceRateLimitRefresh === true ||
      next.forceRateLimitRefresh === true,
    refreshActiveRateLimitOnly:
      current.refreshActiveRateLimitOnly === true &&
      next.refreshActiveRateLimitOnly === true,
  }
}

export function normalizeRateLimitAutoRefreshIntervalSeconds(
  value: unknown,
  defaultValue: number = DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue
  }

  if (value <= 0) {
    return 0
  }

  return clamp(
    value,
    MIN_ENABLED_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
    MAX_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * How often shared state should be polled while a cycle may be due. Polling
 * only reads small state files; it does not imply a Codex launch.
 */
export function derivePollIntervalSeconds(intervalSeconds: number): number {
  return clamp(intervalSeconds / 6, 10, 120)
}

/**
 * Initial automatic-retry delay after a failed maintenance attempt, before
 * exponential backoff capped at the user interval.
 */
export function deriveInitialFailureRetrySeconds(
  intervalSeconds: number,
): number {
  return clamp(intervalSeconds / 4, 30, 900)
}

export function deriveMaxFailureBackoffSeconds(
  intervalSeconds: number,
): number {
  return intervalSeconds
}

/**
 * Startup jitter spreads concurrent extension hosts so they do not all inspect
 * shared state at the same instant. `random` must return a value in [0, 1).
 */
export function deriveStartupJitterSeconds(
  intervalSeconds: number,
  random: () => number,
): number {
  const pollInterval = derivePollIntervalSeconds(intervalSeconds)
  return random() * Math.min(pollInterval, 15)
}
