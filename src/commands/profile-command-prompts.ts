import * as vscode from 'vscode'
import { AuthData } from '../types'
import { buildDefaultProfileName } from '../utils/profile-names'

export interface ProfileCommandPromptDeps {
  getActiveCodexAuthPath: () => string
  getLoginCommandText: () => string
  loadAuthDataFromFile: (path: string) => Promise<AuthData | null>
  findDuplicateProfile: (
    authData: AuthData,
  ) => Promise<{ id: string; name: string } | undefined>
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  createProfile: (name: string, authData: AuthData) => Promise<{ id: string }>
  setActiveProfileId: (profileId: string) => Promise<boolean>
  preserveLiveAuthForMatchingProfile: () => Promise<{
    status: 'noLiveAuth' | 'saved' | 'unsaved'
  }>
  updateCodexCliPath: (path: string) => Promise<void>
  hasCodexCli: () => boolean
  executeCommand: typeof vscode.commands.executeCommand
  showErrorMessage: typeof vscode.window.showErrorMessage
  showInformationMessage: typeof vscode.window.showInformationMessage
  showWarningMessage: typeof vscode.window.showWarningMessage
  showInputBox: typeof vscode.window.showInputBox
  showOpenDialog: typeof vscode.window.showOpenDialog
  translate: typeof vscode.l10n.t
  restartAfterImport: () => Promise<void>
  onAuthChanged: (options?: {
    forceRateLimitRefresh?: boolean
  }) => Promise<void>
}

export async function addCurrentAuthJsonAsProfile(
  deps: ProfileCommandPromptDeps,
  restartAfterImport: boolean,
): Promise<boolean> {
  try {
    const authPath = deps.getActiveCodexAuthPath()
    const loginCommandText = deps.getLoginCommandText()
    const authData = await deps.loadAuthDataFromFile(authPath)
    if (!authData) {
      deps.showErrorMessage(
        deps.translate(
          'Could not read auth from {0}. Run "{1}" first.',
          authPath,
          loginCommandText,
        ),
      )
      return false
    }

    const existing = await deps.findDuplicateProfile(authData)
    if (existing) {
      const replaceLabel = deps.translate('Replace')
      const pick = await deps.showWarningMessage(
        deps.translate(
          'This account is already saved as profile "{0}". Replace it?',
          existing.name,
        ),
        { modal: true },
        replaceLabel,
      )
      if (pick !== replaceLabel) {
        return false
      }

      if (!(await deps.replaceProfileAuth(existing.id, authData))) {
        throw new Error(deps.translate('Failed to update the saved profile.'))
      }
      if (!(await deps.setActiveProfileId(existing.id))) {
        throw new Error(deps.translate('Failed to activate the saved profile.'))
      }
      await deps.onAuthChanged()
      if (restartAfterImport) {
        await deps.restartAfterImport()
      }
      return true
    }

    const defaultName = buildDefaultProfileName(
      undefined,
      authData.email,
      'profile',
    )
    const name = await deps.showInputBox({
      prompt: deps.translate('Profile name (for example "work" or "personal")'),
      value: defaultName,
    })
    if (!name || !name.trim()) {
      return false
    }

    const profile = await deps.createProfile(name, authData)
    if (!(await deps.setActiveProfileId(profile.id))) {
      throw new Error(deps.translate('Failed to activate the new profile.'))
    }
    await deps.onAuthChanged()
    if (restartAfterImport) {
      await deps.restartAfterImport()
    }
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : deps.translate('Unknown profile creation error.')
    deps.showErrorMessage(
      deps.translate(
        'Failed to save the current auth as a profile: {0}',
        message,
      ),
    )
    return false
  }
}

export async function ensureLiveAuthIsSavedBeforeReplacing(
  deps: ProfileCommandPromptDeps,
  operationName: string,
): Promise<boolean> {
  const result = await deps.preserveLiveAuthForMatchingProfile()
  if (result.status !== 'unsaved') {
    return true
  }

  const saveAndContinueLabel = deps.translate('Save Profile and Continue')
  const continueWithoutSavingLabel = deps.translate('Continue without saving')
  const pick = await deps.showWarningMessage(
    deps.translate(
      'The current Codex account is not saved in Codex Switch. If you continue to {0}, this local login will be removed or overwritten and you will need to sign in again to recover it.',
      operationName,
    ),
    { modal: true },
    saveAndContinueLabel,
    continueWithoutSavingLabel,
  )

  if (!pick) {
    return false
  }
  if (pick === continueWithoutSavingLabel) {
    return true
  }
  if (pick === saveAndContinueLabel) {
    return addCurrentAuthJsonAsProfile(deps, false)
  }
  return false
}

export async function ensureCodexCliForRateLimits(
  deps: Pick<
    ProfileCommandPromptDeps,
    | 'hasCodexCli'
    | 'executeCommand'
    | 'showWarningMessage'
    | 'showOpenDialog'
    | 'showInformationMessage'
    | 'translate'
    | 'updateCodexCliPath'
  >,
): Promise<boolean> {
  if (deps.hasCodexCli()) {
    return true
  }

  const setPathLabel = deps.translate('Set CLI Path')
  const openSettingsLabel = deps.translate('Open Settings')
  const pick = await deps.showWarningMessage(
    deps.translate(
      'Codex CLI was not found. Set the Codex CLI path to refresh account limits.',
    ),
    setPathLabel,
    openSettingsLabel,
  )

  if (pick === openSettingsLabel) {
    await deps.executeCommand(
      'workbench.action.openSettings',
      'codexSwitch.codexCliPath',
    )
    return false
  }

  if (pick !== setPathLabel) {
    return false
  }

  const selection = await deps.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: setPathLabel,
    title: deps.translate('Select Codex CLI binary'),
    filters:
      process.platform === 'win32'
        ? { Executables: ['exe', 'cmd'], All: ['*'] }
        : undefined,
  })

  if (!selection?.[0]) {
    return false
  }

  await deps.updateCodexCliPath(selection[0].fsPath)
  deps.showInformationMessage(deps.translate('Codex CLI path saved.'))
  return true
}
