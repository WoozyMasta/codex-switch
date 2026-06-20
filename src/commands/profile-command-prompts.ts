import * as vscode from 'vscode'
import { AuthData } from '../types'
import { buildDefaultProfileName } from '../utils/profile-names'

/**
 * Dependencies for profile command prompt functions.
 */
export interface ProfileCommandPromptDeps {
  /** Function to get the active Codex auth file path. */
  getActiveCodexAuthPath: () => string
  /** Function to get the login command text. */
  getLoginCommandText: () => string
  /** Function to load auth data from a file. */
  loadAuthDataFromFile: (path: string) => Promise<AuthData | null>
  /** Function to find a duplicate profile by auth data. */
  findDuplicateProfile: (
    authData: AuthData,
  ) => Promise<{ id: string; name: string } | undefined>
  /** Function to replace a profile's authentication. */
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  /** Function to create a new profile. */
  createProfile: (name: string, authData: AuthData) => Promise<{ id: string }>
  /** Function to set the active profile. */
  setActiveProfileId: (profileId: string) => Promise<boolean>
  /** Function to preserve live auth for a matching profile. */
  preserveLiveAuthForMatchingProfile: () => Promise<{
    status: 'noLiveAuth' | 'saved' | 'unsaved'
  }>
  /** Function to update the Codex CLI path. */
  updateCodexCliPath: (path: string) => Promise<void>
  /** Function to check if Codex CLI is available. */
  hasCodexCli: () => boolean
  /** Function to execute VS Code commands. */
  executeCommand: typeof vscode.commands.executeCommand
  /** Function to show error messages. */
  showErrorMessage: typeof vscode.window.showErrorMessage
  /** Function to show information messages. */
  showInformationMessage: typeof vscode.window.showInformationMessage
  /** Function to show warning messages. */
  showWarningMessage: typeof vscode.window.showWarningMessage
  /** Function to show input boxes. */
  showInputBox: typeof vscode.window.showInputBox
  /** Function to show file open dialogs. */
  showOpenDialog: typeof vscode.window.showOpenDialog
  /** Function to translate localized strings. */
  translate: typeof vscode.l10n.t
  /** Function to restart the extension after import. */
  restartAfterImport: () => Promise<void>
  /** Function to invoke when authentication changes. */
  onAuthChanged: (options?: {
    forceRateLimitRefresh?: boolean
  }) => Promise<void>
}

/**
 * Prompts the user to add the current Codex auth.json as a profile.
 * Handles deduplication, replacement, and profile activation.
 * @param deps - Dependencies for prompts and profile operations.
 * @param restartAfterImport - Whether to restart the extension after successful import.
 * @returns A promise that resolves to true if the profile was successfully added or updated, false if canceled.
 */
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

/**
 * Ensures that the current live Codex authentication is saved before allowing an operation.
 * Prompts the user to save if there is unsaved live auth.
 * @param deps - Dependencies for prompts and profile operations.
 * @param operationName - The name of the operation being performed (for the warning message).
 * @returns A promise that resolves to true if safe to proceed, false if the user canceled.
 */
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

/**
 * Ensures the Codex CLI is available for rate limit operations.
 * If not found, prompts the user to set the CLI path.
 * @param deps - Subset of dependencies needed for CLI configuration.
 * @returns A promise that resolves to true if CLI is available or user completed setup, false otherwise.
 */
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
