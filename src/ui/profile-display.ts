import * as vscode from 'vscode'
import { ProfileRateLimits } from '../types'
import {
  buildProfileMetaDisplay as buildProfileMetaDisplayText,
  formatProfilePlanDisplay,
  formatProfileRateLimitsDisplay,
} from '../utils/profile-display'

export function getProfilePlanDisplay(planType: string): string {
  return formatProfilePlanDisplay(planType, vscode.l10n.t('Unknown'))
}

export function formatProfileRateLimits(
  rateLimits?: ProfileRateLimits | null,
): string | null {
  return formatProfileRateLimitsDisplay(rateLimits, {
    unknown: vscode.l10n.t('Unknown'),
    fiveHour: vscode.l10n.t('5h'),
    weekly: vscode.l10n.t('Weekly'),
  })
}

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
