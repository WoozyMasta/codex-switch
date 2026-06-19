import { ProfileRateLimits } from '../types'

const DISPLAY_SEPARATOR = ' • '

export interface ProfileDisplayLabels {
  unknown: string
  fiveHour: string
  weekly: string
}

export const DEFAULT_PROFILE_DISPLAY_LABELS: ProfileDisplayLabels = {
  unknown: 'Unknown',
  fiveHour: '5h',
  weekly: 'Weekly',
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export function formatProfilePlanDisplay(
  planType: string,
  unknownLabel = DEFAULT_PROFILE_DISPLAY_LABELS.unknown,
): string {
  const rawPlan = planType || unknownLabel
  return rawPlan === unknownLabel ? unknownLabel : rawPlan.toUpperCase()
}

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
