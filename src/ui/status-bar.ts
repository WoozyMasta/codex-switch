import * as vscode from 'vscode'
import { ProfileSummary, ResolvedCodexHome } from '../types'
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
  home?: ResolvedCodexHome,
) {
  if (!statusBarItem) {
    return
  }

  cachedProfiles = profiles || []

  if (!profile) {
    const homeSuffix = home ? ` @ ${home.name}` : ''
    statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', vscode.l10n.t('none'))}${homeSuffix}`
    statusBarItem.command = 'codex-switch.profile.manage'
    statusBarItem.tooltip = createProfileTooltip(null, cachedProfiles, home)
    return
  }

  const homeSuffix = home ? ` @ ${home.name}` : ''
  statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', profile.name)}${homeSuffix}`
  // If there is nothing meaningful to switch to, go straight to Manage.
  statusBarItem.command =
    cachedProfiles.length <= 1
      ? 'codex-switch.profile.manage'
      : 'codex-switch.profile.toggleLast'
  statusBarItem.tooltip = createProfileTooltip(profile, cachedProfiles, home)
}

export function getStatusBarItem(): vscode.StatusBarItem {
  return statusBarItem
}
