import { ProfileRateLimitWindow } from '../types'
import { escapeMarkdown } from './markdown'

export function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
}

export function escapeLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function escapeTableCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function formatRateLimitCell(
  window: ProfileRateLimitWindow | null | undefined,
): string {
  if (!window) {
    return '-'
  }

  return `${Math.round(window.remainingPercent)}%`
}

export function padTableCell(content: string): string {
  return `&nbsp;${content}&nbsp;`
}

export interface BuildProfileTooltipRowInput {
  profileId: string
  name: string
  plan: string
  fiveHour: string
  fiveHourReset: string
  weekly: string
  weeklyReset: string
  refresh: string
  email: string
  isActive: boolean
}

export function buildProfileTooltipRow(
  input: BuildProfileTooltipRowInput,
): string {
  const switchUri = buildCommandUri('codex-switch.profile.activate', [
    input.profileId,
  ])
  const emailDisplay =
    input.email && input.email !== 'Unknown' ? input.email : 'Unknown'
  const linkTitle = escapeLinkTitle(emailDisplay)
  const name = escapeTableCell(input.name)
  const linkedName = input.isActive
    ? `[**${name}**](${switchUri} "${linkTitle}")`
    : `[${name}](${switchUri} "${linkTitle}")`
  const status = input.isActive ? '$(check)' : ''

  return `| ${padTableCell(status)} | ${padTableCell(linkedName)} | ${padTableCell(input.plan)} | ${padTableCell(input.fiveHour)} | ${padTableCell(input.fiveHourReset)} | ${padTableCell(input.weekly)} | ${padTableCell(input.weeklyReset)} | ${padTableCell(input.refresh)} |\n`
}

export function buildProfileTooltipHomeSection(
  homeName: string,
  homePath: string,
): string {
  return `---\n\n${escapeMarkdown('Active home')}: **${escapeMarkdown(homeName)}**\n\n${escapeMarkdown('Path')}: ${escapeMarkdown(homePath)}\n\n`
}

export function buildProfileTooltipActionsFooter(
  manageProfilesLabel: string,
  refreshLimitsLabel: string,
): string {
  return `---\n\n[${manageProfilesLabel}](command:codex-switch.profile.manage "${escapeLinkTitle(manageProfilesLabel)}") · [${refreshLimitsLabel}](command:codex-switch.profile.refresh "${escapeLinkTitle(refreshLimitsLabel)}")\n\n`
}
