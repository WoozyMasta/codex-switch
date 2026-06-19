import * as vscode from 'vscode'
import type { ProfileManager } from '../auth/profile-manager'
import { ensureCodexCliForRateLimits } from './profile-command-prompts'
import {
  buildManageProfilesQuickPickItems,
  type ProfileManageQuickPickLabels,
} from '../utils/profile-manage-quick-pick'
import { buildProfileListQuickPickItems } from '../utils/profile-quick-pick'
import {
  ProfileCommandPromptDeps,
  ensureLiveAuthIsSavedBeforeReplacing,
} from './profile-command-prompts'

type ProfileManagerCommandProfileManager = Pick<
  ProfileManager,
  | 'getActiveCodexAuthPath'
  | 'getActiveCodexHomeSummary'
  | 'getActiveProfileId'
  | 'getProfile'
  | 'listProfiles'
  | 'prepareForNewLoginChat'
  | 'renameProfile'
  | 'deleteProfile'
  | 'syncActiveProfileFromDefaultHome'
>

export interface ProfileManagementCommandDeps {
  promptDeps: ProfileCommandPromptDeps
  profileManager: ProfileManagerCommandProfileManager
  maybeRestartAfterProfileSwitch: () => Promise<void>
  reloadAfterAuthReset: () => Promise<void>
  onAuthChanged: (options?: {
    forceRateLimitRefresh?: boolean
  }) => Promise<void>
  showQuickPick: typeof vscode.window.showQuickPick
  showInputBox: typeof vscode.window.showInputBox
  showWarningMessage: typeof vscode.window.showWarningMessage
  showInformationMessage: typeof vscode.window.showInformationMessage
  showErrorMessage: typeof vscode.window.showErrorMessage
  executeCommand: typeof vscode.commands.executeCommand
  translate: typeof vscode.l10n.t
  buildManageProfilesLabels: () => ProfileManageQuickPickLabels
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export async function refreshRateLimitsCommand(
  deps: Pick<ProfileManagementCommandDeps, 'promptDeps' | 'onAuthChanged'>,
): Promise<void> {
  if (!(await ensureCodexCliForRateLimits(deps.promptDeps))) {
    return
  }

  await deps.onAuthChanged({ forceRateLimitRefresh: true })
}

export async function prepareForNewLoginChatCommand(
  deps: Pick<
    ProfileManagementCommandDeps,
    | 'promptDeps'
    | 'profileManager'
    | 'reloadAfterAuthReset'
    | 'onAuthChanged'
    | 'showInformationMessage'
    | 'translate'
  >,
): Promise<void> {
  const ok = await ensureLiveAuthIsSavedBeforeReplacing(
    deps.promptDeps,
    deps.translate('prepare for a new login'),
  )
  if (!ok) {
    return
  }

  const result = await deps.profileManager.prepareForNewLoginChat()
  await deps.onAuthChanged()

  if (result.removedAuthFile) {
    deps.showInformationMessage(
      deps.translate(
        'Prepared for a new Codex login. The current auth.json was removed locally and the window will reload so Chat can show the login flow.',
      ),
    )
  } else {
    deps.showInformationMessage(
      deps.translate(
        'Prepared for a new Codex login. No current auth.json was found and the window will reload so Chat can show the login flow.',
      ),
    )
  }

  await deps.reloadAfterAuthReset()
}

export async function manageProfilesCommand(
  deps: Pick<
    ProfileManagementCommandDeps,
    | 'profileManager'
    | 'showQuickPick'
    | 'executeCommand'
    | 'translate'
    | 'buildManageProfilesLabels'
  >,
): Promise<void> {
  const authPath = deps.profileManager.getActiveCodexAuthPath()
  const home = deps.profileManager.getActiveCodexHomeSummary()
  const profiles = await deps.profileManager.listProfiles()
  const hasProfiles = profiles.length > 0

  const action = await deps.showQuickPick(
    buildManageProfilesQuickPickItems(
      authPath,
      home,
      hasProfiles,
      deps.buildManageProfilesLabels(),
    ),
    { placeHolder: deps.translate('Manage profiles') },
  )
  if (!action) {
    return
  }

  await deps.executeCommand(action.command)
}

export async function renameProfileCommand(
  deps: Pick<
    ProfileManagementCommandDeps,
    | 'profileManager'
    | 'showQuickPick'
    | 'showInputBox'
    | 'onAuthChanged'
    | 'showErrorMessage'
    | 'translate'
  >,
): Promise<void> {
  const profiles = await deps.profileManager.listProfiles()
  if (profiles.length === 0) {
    return
  }

  const pick = await deps.showQuickPick(
    buildProfileListQuickPickItems(profiles),
    {
      placeHolder: deps.translate('Rename profile'),
    },
  )
  if (!pick) {
    return
  }

  const newName = await deps.showInputBox({
    prompt: deps.translate('New profile name'),
    value: pick.label,
  })
  if (!newName) {
    return
  }

  try {
    if (!(await deps.profileManager.renameProfile(pick.profileId, newName))) {
      throw new Error(deps.translate('Profile was not updated.'))
    }
    await deps.onAuthChanged()
  } catch (error) {
    const message = getErrorMessage(
      error,
      deps.translate('Unknown rename error.'),
    )
    deps.showErrorMessage(
      deps.translate('Failed to rename profile: {0}', message),
    )
  }
}

export async function deleteProfileCommand(
  deps: Pick<
    ProfileManagementCommandDeps,
    | 'profileManager'
    | 'showQuickPick'
    | 'showWarningMessage'
    | 'showInformationMessage'
    | 'showErrorMessage'
    | 'onAuthChanged'
    | 'translate'
  >,
): Promise<void> {
  const profiles = await deps.profileManager.listProfiles()
  if (profiles.length === 0) {
    return
  }

  const activeProfileId = await deps.profileManager.getActiveProfileId()

  const pick = await deps.showQuickPick(
    buildProfileListQuickPickItems(profiles),
    {
      placeHolder: deps.translate('Delete profile'),
    },
  )
  if (!pick) {
    return
  }

  const deleteLabel = deps.translate('Delete')
  const ok = await deps.showWarningMessage(
    deps.translate('Delete profile "{0}"?', pick.label),
    { modal: true },
    deleteLabel,
  )
  if (ok !== deleteLabel) {
    return
  }

  try {
    if (!(await deps.profileManager.deleteProfile(pick.profileId))) {
      throw new Error(deps.translate('Profile was not deleted.'))
    }
    await deps.onAuthChanged()
    if (activeProfileId === pick.profileId) {
      deps.showInformationMessage(
        deps.translate(
          'Deleted the active profile. The current auth.json remains as an unsaved login.',
        ),
      )
    }
  } catch (error) {
    const message = getErrorMessage(
      error,
      deps.translate('Unknown delete error.'),
    )
    deps.showErrorMessage(
      deps.translate('Failed to delete profile: {0}', message),
    )
  }
}

export async function syncFromDefaultHomeCommand(
  deps: Pick<
    ProfileManagementCommandDeps,
    | 'profileManager'
    | 'onAuthChanged'
    | 'maybeRestartAfterProfileSwitch'
    | 'showInformationMessage'
    | 'translate'
  >,
): Promise<void> {
  const profileId = await deps.profileManager.syncActiveProfileFromDefaultHome()
  if (!profileId) {
    deps.showInformationMessage(
      deps.translate('Default CODEX_HOME has no active profile to sync.'),
    )
    return
  }

  const profile = await deps.profileManager.getProfile(profileId)
  await deps.onAuthChanged()
  await deps.maybeRestartAfterProfileSwitch()
  deps.showInformationMessage(
    deps.translate(
      'Synced active profile from default CODEX_HOME: {0}.',
      profile?.name || profileId,
    ),
  )
}
