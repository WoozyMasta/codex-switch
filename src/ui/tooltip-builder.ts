import * as vscode from 'vscode'
import { ProfileSummary } from '../types'
import { escapeMarkdown } from '../utils/markdown'

export function createProfileTooltip(
  activeProfile: ProfileSummary | null,
  profiles: ProfileSummary[],
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString()
  tooltip.supportThemeIcons = true
  tooltip.supportHtml = false
  tooltip.isTrusted = {
    enabledCommands: [
      'codex-switch.profile.manage',
    ],
  }

  tooltip.appendMarkdown(`${vscode.l10n.t('Codex accounts')}\n\n`)

  if (!profiles || profiles.length === 0) {
    tooltip.appendMarkdown(`${vscode.l10n.t('No profiles yet.')}\n\n`)
  } else {
    const activeId = activeProfile?.id
    for (const p of profiles) {
      const name = escapeMarkdown(p.name)
      const rawPlan = p.planType || 'Unknown'
      const planDisplay =
        rawPlan === 'Unknown'
          ? vscode.l10n.t('Unknown')
          : rawPlan.toUpperCase()
      const plan = escapeMarkdown(planDisplay)

      if (activeId && p.id === activeId) {
        tooltip.appendMarkdown(`* **${name}** - ${plan}\n`)
      } else {
        tooltip.appendMarkdown(`* ${name} - ${plan}\n`)
      }
    }
    tooltip.appendMarkdown('\n')
  }

  tooltip.appendMarkdown(`---\n\n`)
  tooltip.appendMarkdown(
    `[${vscode.l10n.t('Manage profiles')}](command:codex-switch.profile.manage)\n\n`,
  )
  return tooltip
}
