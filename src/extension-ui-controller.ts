import * as vscode from 'vscode'
import type { ExtensionServices } from './extension-services'
import type { ResolvedCodexHome } from './types'
import { errorLog } from './utils/log'
import {
  DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  mergeRefreshOptions,
  normalizeRateLimitAutoRefreshIntervalSeconds,
  type RefreshProfileUiOptions,
} from './utils/refresh-options'
import { restartExtensionHostOrReloadWindow } from './utils/vscode-restart'
import { updateProfileStatus } from './ui/status-bar'

export interface ExtensionUiController {
  refreshUi(options?: RefreshProfileUiOptions): Promise<void>
  reconcileAndRefresh(): Promise<void>
}

export function createExtensionUiController(
  context: vscode.ExtensionContext,
  services: ExtensionServices,
): ExtensionUiController {
  const { profileManager, codexHomeManager, profileRateLimitService, runtime } =
    services

  let refreshProfileUiGeneration = 0
  let refreshProfileUiPromise: Promise<void> | null = null
  let pendingRefreshProfileUiOptions: RefreshProfileUiOptions | null = null
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined

  const refreshProfileUi = async (
    home: ResolvedCodexHome,
    options: RefreshProfileUiOptions = {},
  ): Promise<void> => {
    profileRateLimitService?.cancelPendingWork()
    const generation = ++refreshProfileUiGeneration

    const profiles = await profileManager.listProfiles()
    let activeId = await profileManager.getActiveProfileId()
    if (activeId && !profiles.some((profile) => profile.id === activeId)) {
      await profileManager.setActiveProfileId(undefined)
      activeId = undefined
    }

    const activeHome = codexHomeManager.isEnabled() ? home : undefined
    const cachedProfiles = profileRateLimitService
      ? profileRateLimitService.applyCachedRateLimits(profiles)
      : profiles
    const cachedActiveProfile = activeId
      ? cachedProfiles.find((profile) => profile.id === activeId) || null
      : null

    if (generation !== refreshProfileUiGeneration) {
      return
    }

    updateProfileStatus(cachedActiveProfile, cachedProfiles, activeHome)

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

    const profilesWithRateLimits =
      await profileRateLimitService.decorateProfiles(
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
      ? mergedProfilesWithRateLimits.find(
          (profile) => profile.id === activeId,
        ) || null
      : null

    if (generation !== refreshProfileUiGeneration) {
      return
    }

    updateProfileStatus(
      activeProfileWithRateLimits,
      mergedProfilesWithRateLimits,
      activeHome,
    )
  }

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
          await refreshProfileUi(runtime.home, currentOptions)
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
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused || !profileRateLimitService) {
        return
      }

      void refreshUi({ refreshActiveRateLimitOnly: true })
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('codexSwitch.storageMode') ||
        event.affectsConfiguration('codexSwitch.codexHome.enabled') ||
        event.affectsConfiguration('chatgpt.runCodexInWindowsSubsystemForLinux')
      ) {
        void (async () => {
          await profileRateLimitService?.dispose()
          vscode.window.showInformationMessage(
            'Codex Switch auth/storage settings changed. Restarting the extension host to apply the new home and storage targets.',
          )
          await restartExtensionHostOrReloadWindow()
        })()
        return
      }

      if (
        event.affectsConfiguration(
          'codexSwitch.rateLimitAutoRefreshIntervalSeconds',
        )
      ) {
        resetAutoRefreshTimer()
      }
    }),
    new vscode.Disposable(() => {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer)
      }
    }),
  )

  return {
    refreshUi,
    reconcileAndRefresh: async () => {
      try {
        await profileManager.reconcileActiveProfileWithCodexAuthFile()
        await refreshUi({ refreshActiveRateLimitOnly: true })
      } catch (error) {
        errorLog('Error reconciling active profile with auth file:', error)
      }
    },
  }
}

function getRateLimitAutoRefreshIntervalSeconds(): number {
  const value = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<number>(
      'rateLimitAutoRefreshIntervalSeconds',
      DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
    )
  return normalizeRateLimitAutoRefreshIntervalSeconds(value)
}
