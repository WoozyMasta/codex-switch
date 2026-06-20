import * as vscode from 'vscode'
import { ProfileRateLimits } from '../types'
import {
  buildProfileMetaDisplay as buildProfileMetaDisplayText,
  formatProfilePlanDisplay,
  formatProfileRateLimitsDisplay,
} from '../utils/profile-display'

/**
 * Formats a profile's plan type for display with localized strings.
 * @param planType - The plan type string from the profile.
 * @returns A formatted display string for the plan type.
 */
export function getProfilePlanDisplay(planType: string): string {
  return formatProfilePlanDisplay(planType, vscode.l10n.t('Unknown'))
}

/**
 * Formats profile rate limits for display with localized strings.
 * @param rateLimits - The rate limits to format, or null/undefined if not available.
 * @returns A formatted display string for rate limits, or null if not available.
 */
export function formatProfileRateLimits(
  rateLimits?: ProfileRateLimits | null,
): string | null {
  return formatProfileRateLimitsDisplay(rateLimits, {
    unknown: vscode.l10n.t('Unknown'),
    fiveHour: vscode.l10n.t('5h'),
    weekly: vscode.l10n.t('Weekly'),
  })
}

/**
 * Builds a complete metadata display string for a profile including plan and rate limits.
 * @param planType - The plan type string from the profile.
 * @param rateLimits - The rate limits to include, or null/undefined if not available.
 * @returns A formatted metadata display string combining plan and rate limits.
 */
export function buildProfileMetaDisplay(
  planType: string,
  rateLimits?: ProfileRateLimits | null,
): string {
  return buildProfileMetaDisplayText(planType, rateLimits, {
    unknown: vscode.l10n.t('Unknown'),
    fiveHour: vscode.l10n.t('5h'),
    weekly: vscode.l10n.t('Weekly'),
  })
}
