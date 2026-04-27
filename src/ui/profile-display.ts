import * as vscode from 'vscode'
import { ProfileRateLimits } from '../types'

const DISPLAY_SEPARATOR = ' • '

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export function getProfilePlanDisplay(planType: string): string {
  const rawPlan = planType || 'Unknown'
  return rawPlan === 'Unknown'
    ? vscode.l10n.t('Unknown')
    : rawPlan.toUpperCase()
}

export function formatProfileRateLimits(
  rateLimits?: ProfileRateLimits | null,
): string | null {
  const parts: string[] = []

  if (rateLimits?.fiveHour) {
    parts.push(
      vscode.l10n.t(
        '5h {0}',
        formatPercent(rateLimits.fiveHour.remainingPercent),
      ),
    )
  }

  if (rateLimits?.weekly) {
    parts.push(
      vscode.l10n.t(
        'Weekly {0}',
        formatPercent(rateLimits.weekly.remainingPercent),
      ),
    )
  }

  return parts.length > 0 ? parts.join(DISPLAY_SEPARATOR) : null
}

export function buildProfileMetaDisplay(
  planType: string,
  rateLimits?: ProfileRateLimits | null,
): string {
  const parts = [getProfilePlanDisplay(planType)]
  const limitsDisplay = formatProfileRateLimits(rateLimits)

  if (limitsDisplay) {
    parts.push(limitsDisplay)
  }

  return parts.join(DISPLAY_SEPARATOR)
}
