import * as vscode from 'vscode'
import { ProfileManager } from './auth/profile-manager'
import { CodexHomeManager } from './codex-home/codex-home-manager'
import {
  createStatusBarItem,
  getStatusBarItem,
  updateProfileStatus,
} from './ui/status-bar'
import { registerCommands } from './commands'
import { debugLog, errorLog } from './utils/log'

let profileManager: ProfileManager | undefined
let codexHomeManager: CodexHomeManager | undefined

export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  codexHomeManager = new CodexHomeManager()
  profileManager = new ProfileManager(context, codexHomeManager)

  const refreshUi = async () => {
    try {
      await refreshProfileUi()
    } catch (error) {
      errorLog('Error refreshing profile UI:', error)
      updateProfileStatus(null, [])
    }
  }

  registerCommands(context, profileManager, codexHomeManager, refreshUi)
  context.subscriptions.push(
    ...profileManager.createWatchers(() => {
      void refreshUi()
    }),
  )

  void (async () => {
    await profileManager.reconcileActiveProfileWithCodexAuthFile()
    await refreshUi()
  })()
}

async function refreshProfileUi() {
  if (!profileManager || !codexHomeManager) {
    updateProfileStatus(null, [])
    return
  }

  const profiles = await profileManager.listProfiles()
  const activeId = await profileManager.getActiveProfileId()
  const home = codexHomeManager.isEnabled()
    ? codexHomeManager.getActiveHome()
    : undefined
  if (!activeId) {
    updateProfileStatus(null, profiles, home)
    return
  }

  const profile = await profileManager.getProfile(activeId)
  if (!profile) {
    await profileManager.setActiveProfileId(undefined)
    updateProfileStatus(null, profiles, home)
    return
  }

  updateProfileStatus(profile, profiles, home)
}

export function deactivate() {
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }
}
