import * as vscode from 'vscode'
import { ProfileSummary } from '../types'
import { createProfileTooltip } from './tooltip-builder'

let statusBarItem: vscode.StatusBarItem
let cachedProfiles: ProfileSummary[] = []

export function createStatusBarItem(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    'codex-switch.profile',
    vscode.StatusBarAlignment.Right,
    100,
  )

  updateProfileStatus(null, [])
  statusBarItem.show()
  return statusBarItem
}

export function updateProfileStatus(
  profile: ProfileSummary | null,
  profiles: ProfileSummary[],
) {
  if (!statusBarItem) return

  cachedProfiles = profiles || []

  if (!profile) {
    statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', vscode.l10n.t('none'))}`
    statusBarItem.command = 'codex-switch.profile.manage'
    statusBarItem.tooltip = createProfileTooltip(null, cachedProfiles)
    return
  }

  statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', profile.name)}`
  statusBarItem.command = 'codex-switch.profile.toggleLast'
  statusBarItem.tooltip = createProfileTooltip(profile, cachedProfiles)
}

export function getStatusBarItem(): vscode.StatusBarItem {
  return statusBarItem
}
