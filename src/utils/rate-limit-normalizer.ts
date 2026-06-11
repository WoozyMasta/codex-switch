import { ProfileRateLimitWindow, ProfileRateLimits } from '../types'

export const FIVE_HOUR_WINDOW_MINUTES = 5 * 60
export const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60
export const CODEX_LIMIT_ID = 'codex'

interface NormalizedRateLimitWindow {
  durationMins: number
  rateLimit: ProfileRateLimitWindow
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isPlausibleUnixTimestampSeconds(value: number): boolean {
  return Number.isFinite(value) && value >= 946684800 && value <= 4102444800
}

function readWindowUsedPercent(window: Record<string, unknown>): number | null {
  const usedPercent = window.usedPercent ?? window.used_percent
  return typeof usedPercent === 'number' && Number.isFinite(usedPercent)
    ? clampPercent(usedPercent)
    : null
}

function readWindowDurationMins(
  window: Record<string, unknown>,
): number | null {
  const durationMins = window.windowDurationMins ?? window.window_minutes
  return typeof durationMins === 'number' &&
    Number.isFinite(durationMins) &&
    Number.isInteger(durationMins) &&
    durationMins > 0
    ? durationMins
    : null
}

function readWindowResetTimestamp(
  window: Record<string, unknown>,
  nowSeconds: number,
): number | null {
  const resetsAt = window.resetsAt ?? window.resets_at
  if (
    typeof resetsAt === 'number' &&
    isPlausibleUnixTimestampSeconds(resetsAt)
  ) {
    return resetsAt
  }

  const resetsInSeconds = window.resets_in_seconds
  if (
    typeof resetsInSeconds === 'number' &&
    Number.isFinite(resetsInSeconds) &&
    resetsInSeconds >= 0
  ) {
    const resetTimestamp = nowSeconds + Math.floor(resetsInSeconds)
    return isPlausibleUnixTimestampSeconds(resetTimestamp)
      ? resetTimestamp
      : null
  }

  return null
}

function normalizeRateLimitWindow(
  window: unknown,
  nowSeconds: number,
): NormalizedRateLimitWindow | null {
  if (!isRecord(window)) {
    return null
  }

  const usedPercent = readWindowUsedPercent(window)
  if (usedPercent === null) {
    return null
  }

  const durationMins = readWindowDurationMins(window)
  if (durationMins === null) {
    return null
  }

  const resetsAt = readWindowResetTimestamp(window, nowSeconds)

  return {
    durationMins,
    rateLimit: {
      usedPercent,
      remainingPercent: clampPercent(100 - usedPercent),
      resetsAt,
    },
  }
}

function findWindowByDuration(
  windows: NormalizedRateLimitWindow[],
  targetDurationMins: number,
): NormalizedRateLimitWindow | null {
  return (
    windows.find((window) => window.durationMins === targetDurationMins) || null
  )
}

function normalizeRateLimitSnapshot(
  snapshot: unknown,
  nowSeconds: number,
): ProfileRateLimits | null {
  if (!isRecord(snapshot)) {
    return null
  }

  const windows = [snapshot.primary, snapshot.secondary].filter(
    (value): value is unknown => value !== null && value !== undefined,
  )
  const normalizedWindows = windows
    .map((window) => normalizeRateLimitWindow(window, nowSeconds))
    .filter((value): value is NormalizedRateLimitWindow => value !== null)

  const fiveHourWindow = findWindowByDuration(
    normalizedWindows,
    FIVE_HOUR_WINDOW_MINUTES,
  )
  const weeklyWindow = findWindowByDuration(
    normalizedWindows,
    WEEKLY_WINDOW_MINUTES,
  )

  if (!fiveHourWindow && !weeklyWindow) {
    return null
  }

  return {
    fiveHour: fiveHourWindow?.rateLimit ?? null,
    weekly: weeklyWindow?.rateLimit ?? null,
  }
}

function readRateLimitSnapshots(response: unknown): unknown[] {
  if (!isRecord(response)) {
    return []
  }

  const snapshots: unknown[] = []
  const byLimitId = response.rateLimitsByLimitId
  if (isRecord(byLimitId) && CODEX_LIMIT_ID in byLimitId) {
    snapshots.push(byLimitId[CODEX_LIMIT_ID])
  }
  snapshots.push(response.rateLimits)
  return snapshots
}

export function normalizeRateLimitResponse(
  response: unknown,
  nowSeconds: number,
): ProfileRateLimits | null {
  const snapshots = readRateLimitSnapshots(response)

  for (const snapshot of snapshots) {
    const normalized = normalizeRateLimitSnapshot(snapshot, nowSeconds)
    if (normalized) {
      return normalized
    }
  }

  return null
}
