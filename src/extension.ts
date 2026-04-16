import * as vscode from 'vscode'
import { ProfileManager } from './auth/profile-manager'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import {
  createStatusBarItem,
  getStatusBarItem,
  updateProfileStatus,
} from './ui/status-bar'
import { registerCommands } from './commands'
import { debugLog, errorLog } from './utils/log'

const RATE_LIMIT_AUTO_REFRESH_INTERVAL_MS = 30 * 1000

let profileManager: ProfileManager | undefined
let profileRateLimitService: ProfileRateLimitService | undefined
let refreshProfileUiGeneration = 0

interface RefreshProfileUiOptions {
  forceRateLimitRefresh?: boolean
}

export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  profileManager = new ProfileManager(context)
  profileRateLimitService = new ProfileRateLimitService()

  let refreshProfileUiPromise: Promise<void> | null = null

  const refreshUi = async (options: RefreshProfileUiOptions = {}) => {
    if (refreshProfileUiPromise) {
      return await refreshProfileUiPromise
    }

    refreshProfileUiPromise = (async () => {
      try {
        await refreshProfileUi(options)
      } catch (error) {
        errorLog('Error refreshing profile UI:', error)
        updateProfileStatus(null, [])
      } finally {
        refreshProfileUiPromise = null
      }
    })()

    try {
      await refreshProfileUiPromise
    } finally {
      refreshProfileUiPromise = null
    }
  }

  registerCommands(context, profileManager, profileRateLimitService, refreshUi)
  context.subscriptions.push(
    ...profileManager.createWatchers(() => {
      void refreshUi()
    }),
  )
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused || !profileRateLimitService) {
        return
      }

      void refreshUi({ forceRateLimitRefresh: true })
    }),
  )

  const autoRefreshTimer = setInterval(() => {
    if (!profileRateLimitService || !vscode.window.state.focused) {
      return
    }

    void refreshUi({ forceRateLimitRefresh: true })
  }, RATE_LIMIT_AUTO_REFRESH_INTERVAL_MS)
  context.subscriptions.push(
    new vscode.Disposable(() => {
      clearInterval(autoRefreshTimer)
    }),
  )
  void refreshUi()
  void profileManager.syncActiveProfileToCodexAuthFile()
}

async function refreshProfileUi(options: RefreshProfileUiOptions = {}) {
  if (!profileManager) {
    updateProfileStatus(null, [])
    return
  }

  const generation = ++refreshProfileUiGeneration

  const profiles = await profileManager.listProfiles()
  let activeId = await profileManager.getActiveProfileId()
  if (activeId && !profiles.some((profile) => profile.id === activeId)) {
    await profileManager.setActiveProfileId(undefined)
    activeId = undefined
  }

  const cachedProfiles = profileRateLimitService
    ? profileRateLimitService.applyCachedRateLimits(profiles)
    : profiles
  const cachedActiveProfile = activeId
    ? cachedProfiles.find((profile) => profile.id === activeId) || null
    : null

  if (generation !== refreshProfileUiGeneration) {
    return
  }

  updateProfileStatus(cachedActiveProfile, cachedProfiles)

  if (!profileRateLimitService || profiles.length === 0) {
    return
  }

  const profilesWithRateLimits = await profileRateLimitService.decorateProfiles(
    profileManager,
    profiles,
    {
      forceRefresh: options.forceRateLimitRefresh === true,
    },
  )
  const activeProfileWithRateLimits = activeId
    ? profilesWithRateLimits.find((profile) => profile.id === activeId) || null
    : null

  if (generation !== refreshProfileUiGeneration) {
    return
  }

  updateProfileStatus(activeProfileWithRateLimits, profilesWithRateLimits)
}

export function deactivate() {
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }
}
