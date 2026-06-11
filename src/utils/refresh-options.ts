export interface RefreshProfileUiOptions {
  forceRateLimitRefresh?: boolean
  refreshActiveRateLimitOnly?: boolean
}

export const DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS = 30

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

  return value > 0 ? Math.max(5, value) : 0
}
