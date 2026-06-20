import { ProfileRateLimits } from '../types'

const DISPLAY_SEPARATOR = ' • '

/** Customizable labels for profile display strings. */
export interface ProfileDisplayLabels {
  /** Label for unknown/missing values. */
  unknown: string
  /** Label for the 5-hour rate-limit window. */
  fiveHour: string
  /** Label for the weekly rate-limit window. */
  weekly: string
}

/** Default labels for profile display in the VS Code UI. */
export const DEFAULT_PROFILE_DISPLAY_LABELS: ProfileDisplayLabels = {
  unknown: 'Unknown',
  fiveHour: '5h',
  weekly: 'Weekly',
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

/** Formats a plan type for display, converting to uppercase unless it's the unknown label. */
export function formatProfilePlanDisplay(
  planType: string,
  unknownLabel = DEFAULT_PROFILE_DISPLAY_LABELS.unknown,
): string {
  const rawPlan = planType || unknownLabel
  return rawPlan === unknownLabel ? unknownLabel : rawPlan.toUpperCase()
}

/** Formats rate limits for display as a readable string (e.g., "5h 75% • Weekly 50%"), or null if none available. */
export function formatProfileRateLimitsDisplay(
  rateLimits?: ProfileRateLimits | null,
  labels: ProfileDisplayLabels = DEFAULT_PROFILE_DISPLAY_LABELS,
): string | null {
  const parts: string[] = []

  if (rateLimits?.fiveHour) {
    parts.push(
      `${labels.fiveHour} ${formatPercent(rateLimits.fiveHour.remainingPercent)}`,
    )
  }

  if (rateLimits?.weekly) {
    parts.push(
      `${labels.weekly} ${formatPercent(rateLimits.weekly.remainingPercent)}`,
    )
  }

  return parts.length > 0 ? parts.join(DISPLAY_SEPARATOR) : null
}

/** Builds a complete profile metadata display string combining plan type and rate limits. */
export function buildProfileMetaDisplay(
  planType: string,
  rateLimits?: ProfileRateLimits | null,
  labels: ProfileDisplayLabels = DEFAULT_PROFILE_DISPLAY_LABELS,
): string {
  const parts = [formatProfilePlanDisplay(planType, labels.unknown)]
  const limitsDisplay = formatProfileRateLimitsDisplay(rateLimits, labels)

  if (limitsDisplay) {
    parts.push(limitsDisplay)
  }

  return parts.join(DISPLAY_SEPARATOR)
}
