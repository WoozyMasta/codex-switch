import { ProfileRateLimitWindow } from '../types'
import { escapeMarkdown } from './markdown'

/** Constructs a VS Code command URI with JSON-encoded arguments. */
export function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
}

/** Escapes backslashes and quotes for safe use in markdown link titles. */
export function escapeLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Escapes markdown and pipe characters, removing line breaks for table cells. */
export function escapeTableCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** Formats a rate limit window as a percentage string, or '-' if unavailable. */
export function formatRateLimitCell(
  window: ProfileRateLimitWindow | null | undefined,
): string {
  if (!window) {
    return '-'
  }

  return `${Math.round(window.remainingPercent)}%`
}

/** Adds non-breaking spaces around content for table cell padding. */
export function padTableCell(content: string): string {
  return `&nbsp;${content}&nbsp;`
}

/** Input data for building a profile row in the tooltip table. */
export interface BuildProfileTooltipRowInput {
  /** Profile ID for the activation command. */
  profileId: string
  /** Profile display name. */
  name: string
  /** Plan type (e.g. 'Pro', 'Free'). */
  plan: string
  /** 5-hour rate limit usage. */
  fiveHour: string
  /** 5-hour rate limit reset time. */
  fiveHourReset: string
  /** Weekly rate limit usage. */
  weekly: string
  /** Weekly rate limit reset time. */
  weeklyReset: string
  /** Last refresh time. */
  refresh: string
  /** Email address. */
  email: string
  /** Whether this profile is currently active. */
  isActive: boolean
}

/** Builds a markdown table row for a profile with clickable name linking to activation command. */
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

/** Builds the home information section of the tooltip with name and path. */
export function buildProfileTooltipHomeSection(
  homeName: string,
  homePath: string,
): string {
  return `---\n\n${escapeMarkdown('Active home')}: **${escapeMarkdown(homeName)}**\n\n${escapeMarkdown('Path')}: ${escapeMarkdown(homePath)}\n\n`
}

/** Builds the footer section with action links for managing profiles and refreshing limits. */
export function buildProfileTooltipActionsFooter(
  manageProfilesLabel: string,
  refreshLimitsLabel: string,
): string {
  return `---\n\n[${manageProfilesLabel}](command:codex-switch.profile.manage "${escapeLinkTitle(manageProfilesLabel)}") · [${refreshLimitsLabel}](command:codex-switch.profile.refresh "${escapeLinkTitle(refreshLimitsLabel)}")\n\n`
}
