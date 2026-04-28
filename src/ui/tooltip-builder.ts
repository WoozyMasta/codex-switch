import * as vscode from 'vscode'
import { ProfileRateLimitWindow, ProfileSummary } from '../types'
import { getProfilePlanDisplay } from './profile-display'
import { escapeMarkdown } from '../utils/markdown'

function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
}

function escapeLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeTableCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function formatRateLimitCell(
  window: ProfileRateLimitWindow | null | undefined,
): string {
  if (!window) {
    return '-'
  }

  return `${Math.round(window.remainingPercent)}%`
}

function formatResetTime(resetsAt: number | null | undefined): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) {
    return null
  }

  const resetDate = new Date(resetsAt * 1000)
  if (Number.isNaN(resetDate.getTime())) {
    return null
  }

  const now = new Date()
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(resetDate)

  if (isSameLocalDate(resetDate, now)) {
    return time
  }

  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
  }).format(resetDate)
  return `${day} ${time}`
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function padTableCell(content: string): string {
  return `&nbsp;${content}&nbsp;`
}

export function createProfileTooltip(
  activeProfile: ProfileSummary | null,
  profiles: ProfileSummary[],
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
      const name = escapeTableCell(p.name)
      const plan = escapeTableCell(getProfilePlanDisplay(p.planType))
      const fiveHour = escapeTableCell(
        formatRateLimitCell(p.rateLimits?.fiveHour),
      )
      const fiveHourReset = escapeTableCell(
        formatResetTime(p.rateLimits?.fiveHour?.resetsAt) || '',
      )
      const weekly = escapeTableCell(formatRateLimitCell(p.rateLimits?.weekly))
      const weeklyReset = escapeTableCell(
        formatResetTime(p.rateLimits?.weekly?.resetsAt) || '',
      )
      const switchUri = buildCommandUri('codex-switch.profile.activate', [p.id])
      const emailDisplay =
        p.email && p.email !== 'Unknown' ? p.email : vscode.l10n.t('Unknown')
      const linkTitle = escapeLinkTitle(emailDisplay)
      const isActive = Boolean(activeId && p.id === activeId)
      const linkedName = isActive
        ? `[**${name}**](${switchUri} "${linkTitle}")`
        : `[${name}](${switchUri} "${linkTitle}")`
      const status = isActive ? '$(check)' : ''

      tooltip.appendMarkdown(
        `| ${padTableCell(status)} | ${padTableCell(linkedName)} | ${padTableCell(plan)} | ${padTableCell(fiveHour)} | ${padTableCell(fiveHourReset)} | ${padTableCell(weekly)} | ${padTableCell(weeklyReset)} |\n`,
      )
    }
    tooltip.appendMarkdown('\n')
  }

  tooltip.appendMarkdown('---\n\n')
  const manageProfilesLabel = vscode.l10n.t('Manage profiles')
  const refreshLimitsLabel = vscode.l10n.t('Refresh limits')
  tooltip.appendMarkdown(
    `[${manageProfilesLabel}](command:codex-switch.profile.manage "${escapeLinkTitle(manageProfilesLabel)}") · [${refreshLimitsLabel}](command:codex-switch.profile.refresh "${escapeLinkTitle(refreshLimitsLabel)}")\n\n`,
  )
  return tooltip
}
