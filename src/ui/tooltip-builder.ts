import * as vscode from 'vscode'
import { ProfileSummary, ResolvedCodexHome } from '../types'
import { getProfilePlanDisplay } from './profile-display'
import { formatProfileResetTime } from '../utils/profile-reset-time'
import { formatProfileEmailLabel } from '../utils/profile-email'
import {
  buildProfileTooltipActionsFooter,
  buildProfileTooltipHomeSection,
  buildProfileTooltipRow,
  escapeTableCell,
  formatRateLimitCell,
  padTableCell,
} from '../utils/profile-tooltip-format'

/**
 * Creates a markdown tooltip for displaying profile information.
 * Shows a table of all profiles with their plan type, rate limits, and refresh status.
 * @param activeProfile - The currently active profile, or null if none is active.
 * @param profiles - All available profiles to display in the tooltip.
 * @param home - The currently active Codex home, if applicable.
 * @param getRefreshLabel - Optional function to get the refresh status label for each profile.
 * @returns A VS Code MarkdownString containing the formatted tooltip.
 */
export function createProfileTooltip(
  activeProfile: ProfileSummary | null,
  profiles: ProfileSummary[],
  home?: ResolvedCodexHome,
  getRefreshLabel?: (profileId: string) => string,
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString()
  tooltip.supportThemeIcons = true
  tooltip.supportHtml = true
  tooltip.isTrusted = {
    enabledCommands: [
      'codex-switch.profile.manage',
      'codex-switch.profile.activate',
      'codex-switch.profile.refresh',
    ],
  }

  tooltip.appendMarkdown(`${vscode.l10n.t('Codex accounts')}\n\n`)

  if (!profiles || profiles.length === 0) {
    tooltip.appendMarkdown(`${vscode.l10n.t('No profiles yet.')}\n\n`)
  } else {
    const activeId = activeProfile?.id
    tooltip.appendMarkdown(
      `|  | ${padTableCell(escapeTableCell(vscode.l10n.t('Profile')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Plan')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('5h')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Reset')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Weekly')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Reset')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Refresh')))} |\n`,
    )
    tooltip.appendMarkdown('|---|---|---|---:|---|---:|---|---|\n')

    for (const p of profiles) {
      const plan = escapeTableCell(getProfilePlanDisplay(p.planType))
      const fiveHour = escapeTableCell(
        formatRateLimitCell(p.rateLimits?.fiveHour),
      )
      const fiveHourReset = escapeTableCell(
        formatProfileResetTime(p.rateLimits?.fiveHour?.resetsAt) || '',
      )
      const weekly = escapeTableCell(formatRateLimitCell(p.rateLimits?.weekly))
      const weeklyReset = escapeTableCell(
        formatProfileResetTime(p.rateLimits?.weekly?.resetsAt) || '',
      )
      const emailDisplay = formatProfileEmailLabel(
        p.email,
        vscode.l10n.t('Unknown'),
      )
      const isActive = Boolean(activeId && p.id === activeId)
      const refresh = escapeTableCell(getRefreshLabel?.(p.id) ?? '')

      tooltip.appendMarkdown(
        buildProfileTooltipRow({
          profileId: p.id,
          name: p.name,
          plan,
          fiveHour,
          fiveHourReset,
          weekly,
          weeklyReset,
          refresh,
          email: emailDisplay,
          isActive,
        }),
      )
    }
    tooltip.appendMarkdown('\n')
  }

  if (home) {
    tooltip.appendMarkdown(
      buildProfileTooltipHomeSection(home.name, home.fsPath),
    )
  }

  tooltip.appendMarkdown(
    buildProfileTooltipActionsFooter(
      vscode.l10n.t('Manage profiles'),
      vscode.l10n.t('Refresh limits'),
    ),
  )
  return tooltip
}
