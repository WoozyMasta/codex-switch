import * as vscode from 'vscode'
import { ProfileManager } from './auth/profile-manager'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import { CodexHomeManager } from './codex-home/codex-home-manager'
import { ResolvedCodexHome } from './types'
import { resolveCodexCliCommand } from './utils/codex-cli-resolver'
import {
  createStatusBarItem,
  getStatusBarItem,
  updateProfileStatus,
} from './ui/status-bar'
import { registerCommands } from './commands'
import { restartExtensionHostOrReloadWindow } from './utils/vscode-restart'
import { debugLog, errorLog, setDebugLoggingEnabledResolver } from './utils/log'
import {
  DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  mergeRefreshOptions,
  normalizeRateLimitAutoRefreshIntervalSeconds,
  type RefreshProfileUiOptions,
} from './utils/refresh-options'

let profileManager: ProfileManager | undefined
let codexHomeManager: CodexHomeManager | undefined
let profileRateLimitService: ProfileRateLimitService | undefined
let refreshProfileUiGeneration = 0

setDebugLoggingEnabledResolver(() => {
  const codexSwitchConfig = vscode.workspace.getConfiguration('codexSwitch')
  if (codexSwitchConfig.has('debugLogging')) {
    return !!codexSwitchConfig.get<boolean>('debugLogging', false)
  }

  return !!vscode.workspace
    .getConfiguration('codexUsage')
    .get<boolean>('debugLogging', false)
})

interface RuntimeContext {
  home: ResolvedCodexHome
}

export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  codexHomeManager = new CodexHomeManager({
    initialCodexHome: process.env.CODEX_HOME,
    codexHomeEnabled: vscode.workspace
      .getConfiguration('codexSwitch')
      .get<boolean>('codexHome.enabled', false),
    useWslAuthPath: vscode.workspace
      .getConfiguration('chatgpt')
      .get<boolean>('runCodexInWindowsSubsystemForLinux', false),
  })
  profileManager = new ProfileManager(context, codexHomeManager)
  profileRateLimitService = new ProfileRateLimitService(
    String(context.extension.packageJSON.version || 'unknown'),
    {
      debugLog,
      resolveCodexCliCommand,
    },
  )
  const runtime: RuntimeContext = {
    home: codexHomeManager.getActiveHome(),
  }

  if (codexHomeManager.isWslCustomHomeUnsupported()) {
    vscode.window.showErrorMessage(
      'Codex Switch does not support a custom CODEX_HOME when Chat runs Codex in WSL. Disable codexHome.enabled or turn off runCodexInWindowsSubsystemForLinux.',
    )
    return
  }

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

  registerCommands(
    context,
    profileManager,
    codexHomeManager,
    runtime.home,
    profileRateLimitService,
    refreshUi,
  )

  context.subscriptions.push(
    ...profileManager.createWatchers(() => {
      void refreshUi()
    }, runtime.home.authPath),
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

  void (async () => {
    await profileManager.reconcileActiveProfileWithCodexAuthFile()
    await refreshUi({ refreshActiveRateLimitOnly: true })
  })()
}

async function refreshProfileUi(
  home: ResolvedCodexHome,
  options: RefreshProfileUiOptions = {},
) {
  if (!profileManager || !codexHomeManager) {
    updateProfileStatus(null, [])
    return
  }

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

  updateProfileStatus(
    activeProfileWithRateLimits,
    mergedProfilesWithRateLimits,
    activeHome,
  )
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

export async function deactivate() {
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }

  await profileRateLimitService?.dispose()
}
