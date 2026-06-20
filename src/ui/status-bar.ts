import * as vscode from 'vscode'
import { ProfileSummary, ResolvedCodexHome } from '../types'
import { createProfileTooltip } from './tooltip-builder'

let statusBarItem: vscode.StatusBarItem
let cachedProfiles: ProfileSummary[] = []

/**
 * Creates and initializes the status bar item for displaying the active profile.
 * @returns The created status bar item.
 */
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

/**
 * Updates the status bar item to display the current profile status.
 * @param profile - The currently active profile, or null if none is active.
 * @param profiles - All available profiles for switching context.
 * @param home - The currently active Codex home, if applicable.
 * @param getRefreshLabel - Optional function to get the refresh status label for a profile.
 */
export function updateProfileStatus(
  profile: ProfileSummary | null,
  profiles: ProfileSummary[],
  home?: ResolvedCodexHome,
  getRefreshLabel?: (profileId: string) => string,
) {
  if (!statusBarItem) {
    return
  }

  cachedProfiles = profiles || []

  if (!profile) {
    const homeSuffix = home ? ` @ ${home.name}` : ''
    statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', vscode.l10n.t('none'))}${homeSuffix}`
    statusBarItem.command = 'codex-switch.profile.manage'
    statusBarItem.tooltip = createProfileTooltip(
      null,
      cachedProfiles,
      home,
      getRefreshLabel,
    )
    return
  }

  const homeSuffix = home ? ` @ ${home.name}` : ''
  statusBarItem.text = `$(account) ${vscode.l10n.t('Codex: {0}', profile.name)}${homeSuffix}`
  // If there is nothing meaningful to switch to, go straight to Manage.
  statusBarItem.command =
    cachedProfiles.length <= 1
      ? 'codex-switch.profile.manage'
      : 'codex-switch.profile.toggleLast'
  statusBarItem.tooltip = createProfileTooltip(
    profile,
    cachedProfiles,
    home,
    getRefreshLabel,
  )
}

/**
 * Gets the current status bar item instance.
 * @returns The status bar item.
 */
export function getStatusBarItem(): vscode.StatusBarItem {
  return statusBarItem
}
