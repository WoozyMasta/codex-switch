import * as vscode from 'vscode'
import type { ProfileManager } from '../auth/profile-manager'
import type { ProfileRateLimitService } from '../auth/profile-rate-limit-service'
import type { ResolvedCodexHome } from '../types'
import { buildProfileMetaDisplay } from '../ui/profile-display'
import {
  ensureLiveAuthIsSavedBeforeReplacing,
  type ProfileCommandPromptDeps,
} from './profile-command-prompts'
import {
  buildProfileSwitchQuickPickItems,
  type ProfileQuickPickItem,
} from '../utils/profile-quick-pick'
import { type StatusBarClickBehavior } from '../utils/profile-command-options'
import { formatProfileRefreshLabel } from '../utils/profile-refresh-status'
import type { ProfileSummary } from '../types'

type ProfileNavigationProfileManager = Pick<
  ProfileManager,
  | 'listProfiles'
  | 'getActiveProfileId'
  | 'setActiveProfileId'
  | 'toggleLastProfileId'
>

type ProfileNavigationRateLimitService = Pick<
  ProfileRateLimitService,
  'applyCachedRateLimits' | 'decorateProfiles' | 'getRefreshStatus'
>

export interface ProfileNavigationCommandDeps {
  promptDeps: ProfileCommandPromptDeps
  profileManager: ProfileNavigationProfileManager
  profileRateLimitService: ProfileNavigationRateLimitService
  maybeRestartAfterProfileSwitch: () => Promise<void>
  onAuthChanged: () => Promise<void>
  createQuickPick: typeof vscode.window.createQuickPick
  showInformationMessage: typeof vscode.window.showInformationMessage
  executeCommand: typeof vscode.commands.executeCommand
  translate: typeof vscode.l10n.t
  getRateLimitAutoRefreshIntervalSeconds: () => number
  getLoginCommandText: () => string
  createCodexTerminal: (
    profileId?: string,
    runtimeHome?: ResolvedCodexHome,
  ) => vscode.Terminal
  runtimeHome: ResolvedCodexHome
  writeClipboardText: (value: string) => Promise<void>
  getStatusBarClickBehavior: () => StatusBarClickBehavior
}

async function activateProfileId(
  deps: Pick<
    ProfileNavigationCommandDeps,
    | 'promptDeps'
    | 'profileManager'
    | 'maybeRestartAfterProfileSwitch'
    | 'onAuthChanged'
    | 'translate'
  >,
  profileId: string,
): Promise<void> {
  const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
    deps.promptDeps,
    deps.translate('switch profiles'),
  )
  if (!canReplaceLiveAuth) {
    return
  }

  const ok = await deps.profileManager.setActiveProfileId(profileId)
  if (!ok) {
    return
  }

  await deps.onAuthChanged()
  await deps.maybeRestartAfterProfileSwitch()
}

export async function loginCommand(
  deps: Pick<
    ProfileNavigationCommandDeps,
    | 'showInformationMessage'
    | 'executeCommand'
    | 'createCodexTerminal'
    | 'runtimeHome'
    | 'getLoginCommandText'
    | 'translate'
    | 'writeClipboardText'
  >,
): Promise<void> {
  const loginCommandText = deps.getLoginCommandText()
  const manageLabel = deps.translate('Manage profiles')
  const openTerminalLabel = deps.translate('Open terminal')
  const copyCommandLabel = deps.translate('Copy command')

  const selection = await deps.showInformationMessage(
    deps.translate(
      'Authentication required. Add a profile or run "{0}".',
      loginCommandText,
    ),
    manageLabel,
    openTerminalLabel,
    copyCommandLabel,
  )

  if (selection === manageLabel) {
    await deps.executeCommand('codex-switch.profile.manage')
  } else if (selection === openTerminalLabel) {
    const terminal = deps.createCodexTerminal(undefined, deps.runtimeHome)
    terminal.show()
    terminal.sendText(loginCommandText)
  } else if (selection === copyCommandLabel) {
    await deps.writeClipboardText(loginCommandText)
    deps.showInformationMessage(
      deps.translate('Command "{0}" copied to clipboard.', loginCommandText),
    )
  }
}

export async function switchProfileCommand(
  deps: Pick<
    ProfileNavigationCommandDeps,
    | 'promptDeps'
    | 'profileManager'
    | 'profileRateLimitService'
    | 'executeCommand'
    | 'translate'
    | 'getRateLimitAutoRefreshIntervalSeconds'
    | 'maybeRestartAfterProfileSwitch'
    | 'onAuthChanged'
    | 'createQuickPick'
  >,
): Promise<void> {
  const rawProfiles = await deps.profileManager.listProfiles()
  if (rawProfiles.length === 0) {
    await deps.executeCommand('codex-switch.profile.manage')
    return
  }

  const activeId = await deps.profileManager.getActiveProfileId()
  const intervalSeconds = deps.getRateLimitAutoRefreshIntervalSeconds()
  const refreshLabelNow = Date.now()
  const formatRefreshLabel = (profile: ProfileSummary): string =>
    formatProfileRefreshLabel(
      deps.profileRateLimitService.getRefreshStatus(profile, intervalSeconds),
      {
        now: refreshLabelNow,
        autoRefreshEnabled: intervalSeconds > 0,
        translate: (message, ...args) => deps.translate(message, ...args),
      },
    )
  const quickPick = deps.createQuickPick<ProfileQuickPickItem>()
  quickPick.placeholder = deps.translate('Switch profile')
  quickPick.items = buildProfileSwitchQuickPickItems(
    deps.profileRateLimitService.applyCachedRateLimits(rawProfiles),
    activeId,
    deps.translate('Active'),
    (profile) => buildProfileMetaDisplay(profile.planType, profile.rateLimits),
    formatRefreshLabel,
  )
  quickPick.busy = true

  let disposed = false
  let pickedProfileId: string | undefined
  const pickPromise = new Promise<string | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      pickedProfileId = quickPick.selectedItems[0]?.profileId
      quickPick.hide()
    })
    quickPick.onDidHide(() => {
      disposed = true
      quickPick.dispose()
      resolve(pickedProfileId)
    })
  })

  quickPick.show()

  try {
    const profiles = await deps.profileRateLimitService.decorateProfiles(
      deps.profileManager as Parameters<
        ProfileNavigationRateLimitService['decorateProfiles']
      >[0],
      rawProfiles,
    )
    if (!disposed) {
      quickPick.items = buildProfileSwitchQuickPickItems(
        profiles,
        activeId,
        deps.translate('Active'),
        (profile) =>
          buildProfileMetaDisplay(profile.planType, profile.rateLimits),
        formatRefreshLabel,
      )
    }
  } catch {
    // Best-effort decoration only.
  } finally {
    if (!disposed) {
      quickPick.busy = false
    }
  }

  const profileId = await pickPromise
  if (!profileId) {
    return
  }

  await activateProfileId(
    {
      promptDeps: deps.promptDeps,
      profileManager: deps.profileManager,
      maybeRestartAfterProfileSwitch: deps.maybeRestartAfterProfileSwitch,
      onAuthChanged: deps.onAuthChanged,
      translate: deps.translate,
    },
    profileId,
  )
}

export async function activateProfileCommand(
  deps: Pick<
    ProfileNavigationCommandDeps,
    | 'promptDeps'
    | 'profileManager'
    | 'maybeRestartAfterProfileSwitch'
    | 'onAuthChanged'
    | 'executeCommand'
    | 'translate'
  >,
  profileId?: string,
): Promise<void> {
  if (!profileId) {
    await deps.executeCommand('codex-switch.profile.switch')
    return
  }

  await activateProfileId(deps, profileId)
}

export async function toggleLastProfileCommand(
  deps: Pick<
    ProfileNavigationCommandDeps,
    | 'promptDeps'
    | 'profileManager'
    | 'executeCommand'
    | 'getStatusBarClickBehavior'
    | 'translate'
    | 'maybeRestartAfterProfileSwitch'
    | 'onAuthChanged'
  >,
): Promise<void> {
  const behavior = deps.getStatusBarClickBehavior()
  if (behavior === 'selector') {
    await deps.executeCommand('codex-switch.profile.switch')
    return
  }

  if (behavior === 'toggleLast') {
    const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
      deps.promptDeps,
      deps.translate('switch profiles'),
    )
    if (!canReplaceLiveAuth) {
      return
    }

    const newId = await deps.profileManager.toggleLastProfileId()
    if (!newId) {
      await deps.executeCommand('codex-switch.profile.switch')
      return
    }
    await deps.onAuthChanged()
    await deps.maybeRestartAfterProfileSwitch()
    return
  }

  const profiles = await deps.profileManager.listProfiles()
  if (profiles.length === 0) {
    await deps.executeCommand('codex-switch.profile.manage')
    return
  }

  const activeId = await deps.profileManager.getActiveProfileId()
  const currentIndex = profiles.findIndex((p) => p.id === activeId)
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % profiles.length
  await activateProfileId(
    {
      promptDeps: deps.promptDeps,
      profileManager: deps.profileManager,
      maybeRestartAfterProfileSwitch: deps.maybeRestartAfterProfileSwitch,
      onAuthChanged: deps.onAuthChanged,
      translate: deps.translate,
    },
    profiles[nextIndex].id,
  )
}
