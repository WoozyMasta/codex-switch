import * as vscode from 'vscode'
import type { ExtensionServices } from './extension-services'
import type { ProfileSummary, ResolvedCodexHome } from './types'
import { errorLog } from './utils/log'
import {
  mergeRefreshOptions,
  type RefreshProfileUiOptions,
} from './utils/refresh-options'
import { getRateLimitAutoRefreshIntervalSeconds } from './utils/refresh-config'
import { restartExtensionHostOrReloadWindow } from './utils/vscode-restart'
import { updateProfileStatus } from './ui/status-bar'
import {
  formatProfileRefreshCells,
  type ProfileRefreshStatus,
} from './utils/profile-refresh-status'
import type { MaintenanceProfileState } from './utils/profile-maintenance-state'

export interface ExtensionUiController {
  refreshUi(options?: RefreshProfileUiOptions): Promise<void>
  reconcileAndRefresh(): Promise<void>
}

export function createExtensionUiController(
  context: vscode.ExtensionContext,
  services: ExtensionServices,
): ExtensionUiController {
  const {
    profileManager,
    codexHomeManager,
    profileRateLimitService,
    profileMaintenanceService,
    runtime,
  } = services

  let refreshProfileUiGeneration = 0
  let refreshProfileUiPromise: Promise<void> | null = null
  let pendingRefreshProfileUiOptions: RefreshProfileUiOptions | null = null

  const mapStateToRefreshStatus = (
    profileId: string,
    state: MaintenanceProfileState | null,
  ): ProfileRefreshStatus => ({
    lastSuccessAt: state?.lastSuccessAt ?? undefined,
    nextDueAt: state?.nextDueAt ?? undefined,
    nextRetryAt: state?.nextRetryAt ?? undefined,
    isRefreshing: profileMaintenanceService.getActiveProfileId() === profileId,
  })

  const loadMaintenanceStates = async (
    profiles: ProfileSummary[],
  ): Promise<Map<string, MaintenanceProfileState | null>> => {
    const entries = await Promise.all(
      profiles.map(
        async (profile): Promise<[string, MaintenanceProfileState | null]> => {
          const state = await profileMaintenanceService
            .readProfileState(profile.id)
            .catch(() => null)
          return [profile.id, state]
        },
      ),
    )
    return new Map(entries)
  }

  const buildRefreshLabel = (
    statuses: Map<string, ProfileRefreshStatus>,
  ): ((profileId: string) => string) => {
    const intervalSeconds = getRateLimitAutoRefreshIntervalSeconds()
    const now = Date.now()
    const autoRefreshEnabled = intervalSeconds > 0
    return (profileId: string): string => {
      const status = statuses.get(profileId)
      if (!status) {
        return ''
      }
      if (status.isRefreshing) {
        return '…'
      }
      const cells = formatProfileRefreshCells(status, {
        now,
        autoRefreshEnabled,
      })
      if (!cells.updated) {
        return ''
      }
      return cells.next ? `${cells.updated}/${cells.next}` : cells.updated
    }
  }

  const refreshProfileUi = async (
    home: ResolvedCodexHome,
    options: RefreshProfileUiOptions = {},
  ): Promise<void> => {
    const generation = ++refreshProfileUiGeneration

    const profiles = await profileManager.listProfiles()
    let activeId = await profileManager.getActiveProfileId()
    if (activeId && !profiles.some((profile) => profile.id === activeId)) {
      await profileManager.setActiveProfileId(undefined)
      activeId = undefined
    }

    const activeHome = codexHomeManager.isEnabled() ? home : undefined

    const maintenanceStates = await loadMaintenanceStates(profiles)

    // Apply in-memory cached rate limits; fall back to the state-file rate limits
    // when the in-memory cache is empty (e.g. after an extension restart or
    // when another window ran the last maintenance cycle).
    const cachedProfiles = profiles.map((profile) => {
      const withCache = profileRateLimitService
        ? profileRateLimitService.applyCachedRateLimits([profile])[0]
        : profile
      if (withCache.rateLimits === undefined) {
        const state = maintenanceStates.get(profile.id)
        if (state?.rateLimits) {
          return { ...withCache, rateLimits: state.rateLimits }
        }
      }
      return withCache
    })

    const statuses = new Map(
      profiles.map((profile) => {
        const state = maintenanceStates.get(profile.id)
        return [profile.id, mapStateToRefreshStatus(profile.id, state ?? null)]
      }),
    )

    const cachedActiveProfile = activeId
      ? cachedProfiles.find((profile) => profile.id === activeId) || null
      : null

    if (generation !== refreshProfileUiGeneration) {
      return
    }

    updateProfileStatus(
      cachedActiveProfile,
      cachedProfiles,
      activeHome,
      buildRefreshLabel(statuses),
    )

    // Background freshness, all-profile coverage, and auth write-back are owned
    // by the maintenance scheduler. A manual refresh forces every profile.
    if (options.forceRateLimitRefresh) {
      void profileMaintenanceService.requestCycle({
        forceProfileIds: profiles.map((profile) => profile.id),
      })
    }
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

  // Re-render whenever the maintenance scheduler publishes a new result.
  profileMaintenanceService.setStateChangedListener(() => {
    void refreshUi()
  })
  profileMaintenanceService.start()

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        return
      }
      // Refresh local UI from shared state and request a cycle without
      // bypassing freshness; the lease prevents duplicate background work.
      void profileMaintenanceService.requestCycle()
      void refreshUi()
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('codexSwitch.storageMode') ||
        event.affectsConfiguration('codexSwitch.codexHome.enabled') ||
        event.affectsConfiguration('chatgpt.runCodexInWindowsSubsystemForLinux')
      ) {
        void (async () => {
          await profileMaintenanceService.dispose()
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
        profileMaintenanceService.reschedule()
        void refreshUi()
      }
    }),
    new vscode.Disposable(() => {
      void profileMaintenanceService.dispose()
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
