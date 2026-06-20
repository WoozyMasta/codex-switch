import * as vscode from 'vscode'
import {
  ExportedSettingsV1,
  ImportProfilesResult,
} from '../auth/profile-transfer-service'
import { writeJsonFile } from '../auth/shared-profile-store'
import {
  addCurrentAuthJsonAsProfile,
  ensureLiveAuthIsSavedBeforeReplacing,
  type ProfileCommandPromptDeps,
} from './profile-command-prompts'

/**
 * Dependencies for profile file command handlers.
 */
export interface ProfileFileCommandDeps {
  /** Dependencies for profile command prompts. */
  promptDeps: ProfileCommandPromptDeps
  /** Function to get the default settings export URI. */
  getDefaultSettingsExportUri: () => vscode.Uri
  /** Function to export profiles for transfer. */
  exportProfilesForTransfer: () => Promise<{
    data: ExportedSettingsV1
    skipped: number
  }>
  /** Function to import profiles from transfer data. */
  importProfilesFromTransfer: (value: unknown) => Promise<ImportProfilesResult>
  /** Function to show file open dialogs. */
  showOpenDialog: typeof vscode.window.showOpenDialog
  /** Function to show file save dialogs. */
  showSaveDialog: typeof vscode.window.showSaveDialog
  /** Function to show warning messages. */
  showWarningMessage: typeof vscode.window.showWarningMessage
  /** Function to show error messages. */
  showErrorMessage: typeof vscode.window.showErrorMessage
  /** Function to show information messages. */
  showInformationMessage: typeof vscode.window.showInformationMessage
  /** Function to translate localized strings. */
  translate: typeof vscode.l10n.t
  /** Function to check if a file path exists. */
  pathExists: (path: string) => boolean
  /** Function to read file text. */
  readFileText: (path: string) => string
  /** Function to restart after profile switch if configured. */
  maybeRestartAfterProfileSwitch: () => Promise<void>
  /** Function to invoke when authentication changes. */
  onAuthChanged: () => Promise<void>
}

/**
 * Handles the "Import auth.json" command to add a profile from a file.
 * @param deps - Dependencies for file handling and profile operations.
 * @returns A promise that resolves when the command completes.
 */
export async function addFromFile(deps: ProfileFileCommandDeps): Promise<void> {
  const uri = await deps.showOpenDialog({
    canSelectMany: false,
    openLabel: deps.translate('Import auth.json'),
    filters: { JSON: ['json'] },
  })
  if (!uri || uri.length === 0) {
    return
  }

  const authData = await deps.promptDeps.loadAuthDataFromFile(uri[0].fsPath)
  if (!authData) {
    deps.showErrorMessage(
      deps.translate('Selected file is not a valid auth.json.'),
    )
    return
  }

  const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
    deps.promptDeps,
    deps.translate('import an auth file'),
  )
  if (!canReplaceLiveAuth) {
    return
  }

  await addCurrentAuthJsonAsProfile(deps.promptDeps, true)
}

/**
 * Handles the "Export profiles" command to export profiles for transfer.
 * @param deps - Dependencies for file handling and profile operations.
 * @returns A promise that resolves when the command completes.
 */
export async function exportProfiles(
  deps: ProfileFileCommandDeps,
): Promise<void> {
  const saveUri = await deps.showSaveDialog({
    saveLabel: deps.translate('Export profiles'),
    defaultUri: deps.getDefaultSettingsExportUri(),
    filters: { JSON: ['json'] },
  })
  if (!saveUri) {
    return
  }

  const exportLabel = deps.translate('Export')
  const warning = await deps.showWarningMessage(
    deps.translate(
      'This will export profile tokens and auth data as unencrypted JSON.',
    ),
    { modal: true },
    exportLabel,
  )
  if (warning !== exportLabel) {
    return
  }

  if (deps.pathExists(saveUri.fsPath)) {
    const overwrite = await deps.showWarningMessage(
      deps.translate('File {0} already exists. Overwrite it?', saveUri.fsPath),
      { modal: true },
      exportLabel,
    )
    if (overwrite !== exportLabel) {
      return
    }
  }

  const { data, skipped } = await deps.exportProfilesForTransfer()
  writeJsonFile(saveUri.fsPath, data)

  deps.showInformationMessage(
    deps.translate(
      'Exported {0} profile(s) to {1}. Skipped {2} profile(s) without tokens.',
      data.profiles.length,
      saveUri.fsPath,
      skipped,
    ),
  )
}

/**
 * Handles the "Import profiles" command to import profiles from a transfer export file.
 * @param deps - Dependencies for file handling and profile operations.
 * @returns A promise that resolves when the command completes.
 */
export async function importProfiles(
  deps: ProfileFileCommandDeps,
): Promise<void> {
  const uri = await deps.showOpenDialog({
    canSelectMany: false,
    openLabel: deps.translate('Import profiles'),
    filters: { JSON: ['json'] },
  })
  if (!uri || uri.length === 0) {
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(deps.readFileText(uri[0].fsPath)) as unknown
  } catch {
    deps.showErrorMessage(
      deps.translate('Selected file is not a valid JSON profiles export.'),
    )
    return
  }

  try {
    const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
      deps.promptDeps,
      deps.translate('import profiles'),
    )
    if (!canReplaceLiveAuth) {
      return
    }

    const result = await deps.importProfilesFromTransfer(payload)
    await deps.onAuthChanged()
    await deps.maybeRestartAfterProfileSwitch()
    deps.showInformationMessage(
      deps.translate(
        'Import completed: created {0}, updated {1}, skipped {2}.',
        result.created,
        result.updated,
        result.skipped,
      ),
    )
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : deps.translate('Unknown import error.')
    deps.showErrorMessage(
      deps.translate('Failed to import profiles: {0}', message),
    )
  }
}
