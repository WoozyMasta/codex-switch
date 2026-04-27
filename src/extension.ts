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

const DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS = 30

let profileManager: ProfileManager | undefined
let profileRateLimitService: ProfileRateLimitService | undefined
let refreshProfileUiGeneration = 0

interface RefreshProfileUiOptions {
  forceRateLimitRefresh?: boolean
  refreshActiveRateLimitOnly?: boolean
}

export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  profileManager = new ProfileManager(context)
  profileRateLimitService = new ProfileRateLimitService()

  let refreshProfileUiPromise: Promise<void> | null = null
  let pendingRefreshProfileUiOptions: RefreshProfileUiOptions | null = null

  const refreshUi = async (options: RefreshProfileUiOptions = {}) => {
    if (refreshProfileUiPromise) {
      pendingRefreshProfileUiOptions = mergeRefreshOptions(
        pendingRefreshProfileUiOptions,
        options,
      )
      return await refreshProfileUiPromise
    }

    refreshProfileUiPromise = (async () => {
      let nextOptions: RefreshProfileUiOptions | null = options
      do {
        const currentOptions = nextOptions
        pendingRefreshProfileUiOptions = null

        try {
          await refreshProfileUi(currentOptions)
        } catch (error) {
          errorLog('Error refreshing profile UI:', error)
          updateProfileStatus(null, [])
        }

        nextOptions = pendingRefreshProfileUiOptions
      } while (nextOptions)
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

      void refreshUi({ refreshActiveRateLimitOnly: true })
    }),
  )

  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined
  const resetAutoRefreshTimer = () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = undefined
    }

    const intervalSeconds = getRateLimitAutoRefreshIntervalSeconds()
    if (intervalSeconds <= 0) {
      return
    }

    autoRefreshTimer = setInterval(() => {
      if (!profileRateLimitService || !vscode.window.state.focused) {
        return
      }

      void refreshUi({ refreshActiveRateLimitOnly: true })
    }, intervalSeconds * 1000)
  }

  resetAutoRefreshTimer()
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexSwitch.rateLimitAutoRefreshIntervalSeconds')) {
        resetAutoRefreshTimer()
      }
    }),
    new vscode.Disposable(() => {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer)
      }
    }),
  )

  void (async () => {
    await profileManager.reconcileActiveProfileWithCodexAuthFile()
    await refreshUi()
  })()
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

  const rateLimitProfiles =
    options.refreshActiveRateLimitOnly && activeId
      ? profiles.filter((profile) => profile.id === activeId)
      : profiles

  if (rateLimitProfiles.length === 0) {
    return
  }

  const profilesWithRateLimits = await profileRateLimitService.decorateProfiles(
    profileManager,
    rateLimitProfiles,
    {
      forceRefresh: options.forceRateLimitRefresh === true,
    },
  )
  const rateLimitProfilesById = new Map(
    profilesWithRateLimits.map((profile) => [profile.id, profile]),
  )
  const mergedProfilesWithRateLimits = cachedProfiles.map(
    (profile) => rateLimitProfilesById.get(profile.id) || profile,
  )
  const activeProfileWithRateLimits = activeId
    ? mergedProfilesWithRateLimits.find((profile) => profile.id === activeId) ||
      null
    : null

  if (generation !== refreshProfileUiGeneration) {
    return
  }

  updateProfileStatus(activeProfileWithRateLimits, mergedProfilesWithRateLimits)
}

function mergeRefreshOptions(
  current: RefreshProfileUiOptions | null,
  next: RefreshProfileUiOptions,
): RefreshProfileUiOptions {
  if (!current) {
    return next
  }

  return {
    forceRateLimitRefresh:
      current.forceRateLimitRefresh === true ||
      next.forceRateLimitRefresh === true,
    refreshActiveRateLimitOnly:
      current.refreshActiveRateLimitOnly === true &&
      next.refreshActiveRateLimitOnly === true,
  }
}

function getRateLimitAutoRefreshIntervalSeconds(): number {
  const value = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<number>(
      'rateLimitAutoRefreshIntervalSeconds',
      DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
    )

  return Number.isFinite(value) && value > 0 ? Math.max(5, value) : 0
}

export function deactivate() {
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }
}
