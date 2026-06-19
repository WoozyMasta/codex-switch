import * as vscode from 'vscode'
import { ProfileSummary, ResolvedCodexHome } from '../types'
import { getProfilePlanDisplay } from './profile-display'
import { formatProfileResetTime } from '../utils/profile-reset-time'
import {
  buildProfileTooltipActionsFooter,
  buildProfileTooltipHomeSection,
  buildProfileTooltipRow,
  escapeTableCell,
  formatRateLimitCell,
  padTableCell,
} from '../utils/profile-tooltip-format'

export function createProfileTooltip(
  activeProfile: ProfileSummary | null,
  profiles: ProfileSummary[],
  home?: ResolvedCodexHome,
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
      `|  | ${padTableCell(escapeTableCell(vscode.l10n.t('Profile')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Plan')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('5h')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Reset')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Weekly')))} | ${padTableCell(escapeTableCell(vscode.l10n.t('Reset')))} |\n`,
    )
    tooltip.appendMarkdown('|---|---|---|---:|---|---:|---|\n')

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
      const emailDisplay =
        p.email && p.email !== 'Unknown' ? p.email : vscode.l10n.t('Unknown')
      const isActive = Boolean(activeId && p.id === activeId)

      tooltip.appendMarkdown(
        buildProfileTooltipRow({
          profileId: p.id,
          name: p.name,
          plan,
          fiveHour,
          fiveHourReset,
          weekly,
          weeklyReset,
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
