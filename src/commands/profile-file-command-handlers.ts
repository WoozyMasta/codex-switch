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

export interface ProfileFileCommandDeps {
  promptDeps: ProfileCommandPromptDeps
  getDefaultSettingsExportUri: () => vscode.Uri
  exportProfilesForTransfer: () => Promise<{
    data: ExportedSettingsV1
    skipped: number
  }>
  importProfilesFromTransfer: (value: unknown) => Promise<ImportProfilesResult>
  showOpenDialog: typeof vscode.window.showOpenDialog
  showSaveDialog: typeof vscode.window.showSaveDialog
  showWarningMessage: typeof vscode.window.showWarningMessage
  showErrorMessage: typeof vscode.window.showErrorMessage
  showInformationMessage: typeof vscode.window.showInformationMessage
  translate: typeof vscode.l10n.t
  pathExists: (path: string) => boolean
  readFileText: (path: string) => string
  maybeRestartAfterProfileSwitch: () => Promise<void>
  onAuthChanged: () => Promise<void>
}

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
