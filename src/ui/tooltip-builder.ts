import * as vscode from 'vscode'
import { ProfileSummary } from '../types'
import { buildProfileMetaDisplay } from './profile-display'
import { escapeMarkdown } from '../utils/markdown'

function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
}

function escapeLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
    for (const p of profiles) {
      const name = escapeMarkdown(p.name)
      const meta = escapeMarkdown(
        buildProfileMetaDisplay(p.planType, p.rateLimits),
      )
      const switchUri = buildCommandUri('codex-switch.profile.activate', [p.id])
      const emailDisplay =
        p.email && p.email !== 'Unknown' ? p.email : vscode.l10n.t('Unknown')
      const linkTitle = escapeLinkTitle(emailDisplay)
      const isActive = Boolean(activeId && p.id === activeId)
      const linkedName = isActive
        ? `[**${name}**](${switchUri} "${linkTitle}")`
        : `[${name}](${switchUri} "${linkTitle}")`

      if (isActive) {
        const activeLabel = escapeMarkdown(vscode.l10n.t('Active'))
        tooltip.appendMarkdown(
          `* ${linkedName} - ${meta} <span style="color: var(--vscode-textLink-activeForeground); font-weight: 600;">(${activeLabel})</span>\n`,
        )
      } else {
        tooltip.appendMarkdown(`* ${linkedName} - ${meta}\n`)
      }
    }
    tooltip.appendMarkdown('\n')
  }

  tooltip.appendMarkdown('---\n\n')
  tooltip.appendMarkdown(
    `[${vscode.l10n.t('Manage profiles')}](command:codex-switch.profile.manage) · [${vscode.l10n.t('Refresh limits')}](command:codex-switch.profile.refresh)\n\n`,
  )
  return tooltip
}
