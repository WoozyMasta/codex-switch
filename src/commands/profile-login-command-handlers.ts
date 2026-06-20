import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import {
  ProfileCommandPromptDeps,
  ensureLiveAuthIsSavedBeforeReplacing,
} from './profile-command-prompts'
import { ResolvedCodexHome } from '../types'

/**
 * Dependencies for the login via CLI command handler.
 */
export interface LoginViaCliDeps {
  /** Dependencies for profile command prompts. */
  promptDeps: ProfileCommandPromptDeps
  /** Function to get the active Codex auth file path. */
  getActiveCodexAuthPath: () => string
  /** Function to get the login command text. */
  getLoginCommandText: () => string
  /** Function to create and show a terminal for Codex commands. */
  createCodexTerminal: (
    name?: string,
    home?: ResolvedCodexHome,
  ) => { show: () => void; sendText: (text: string) => void }
  /** The runtime Codex home configuration. */
  runtimeHome: ResolvedCodexHome
  /** Function to execute VS Code commands. */
  executeCommand: typeof vscode.commands.executeCommand
  /** Function to show information messages. */
  showInformationMessage: typeof vscode.window.showInformationMessage
  /** Function to translate localized strings. */
  translate: typeof vscode.l10n.t
  /** Function to check file existence. */
  fsExistsSync: typeof fs.existsSync
  /** Function to watch directory changes. */
  fsWatch: typeof fs.watch
  /** Function to get directory name from path. */
  dirname: typeof path.dirname
  /** Function to schedule cleanup with timeout. */
  scheduleCleanup: typeof setTimeout
}

/**
 * Handles the "Login via CLI" command to initiate Codex login flow.
 * Opens a terminal and watches for the auth.json file to be created,
 * then prompts to import it as a profile.
 * @param deps - Dependencies for the login command.
 * @returns A promise that resolves when the command completes.
 */
export async function loginViaCli(deps: LoginViaCliDeps): Promise<void> {
  const canReplaceLiveAuth = await ensureLiveAuthIsSavedBeforeReplacing(
    deps.promptDeps,
    deps.translate('start a new login'),
  )
  if (!canReplaceLiveAuth) {
    return
  }

  const authPath = deps.getActiveCodexAuthPath()
  const loginCommandText = deps.getLoginCommandText()

  const terminal = deps.createCodexTerminal(undefined, deps.runtimeHome)
  terminal.show()
  terminal.sendText(loginCommandText)

  const start = Date.now()
  const maxWaitMs = 10 * 60 * 1000

  let watcher: fs.FSWatcher | undefined
  let done = false

  const cleanup = () => {
    done = true
    if (watcher) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
  }

  const promptImport = async () => {
    cleanup()
    const importLabel = deps.translate('Import')
    const pick = await deps.showInformationMessage(
      deps.translate(
        'Codex auth file detected at {0}. Import it as a profile?',
        authPath,
      ),
      importLabel,
    )
    if (pick === importLabel) {
      await deps.executeCommand('codex-switch.profile.addFromCodexAuthFile')
    }
  }

  try {
    const dir = deps.dirname(authPath)
    if (deps.fsExistsSync(dir)) {
      watcher = deps.fsWatch(
        dir,
        { persistent: false },
        async (_event, filename) => {
          if (done) {
            return
          }
          if (!filename) {
            return
          }
          if (String(filename).toLowerCase() !== 'auth.json') {
            return
          }
          if (Date.now() - start > maxWaitMs) {
            cleanup()
            return
          }
          if (deps.fsExistsSync(authPath)) {
            await promptImport()
          }
        },
      )
    }
  } catch {
    // Best effort; fall back to manual import.
  }

  const importNowLabel = deps.translate('Import now')
  const manageLabel = deps.translate('Manage profiles')
  const msg = await deps.showInformationMessage(
    deps.translate(
      'After completing the login flow, import the current environment auth.json from {0} as a profile.',
      authPath,
    ),
    importNowLabel,
    manageLabel,
  )

  if (msg === importNowLabel) {
    cleanup()
    await deps.executeCommand('codex-switch.profile.addFromCodexAuthFile')
  } else if (msg === manageLabel) {
    cleanup()
    await deps.executeCommand('codex-switch.profile.manage')
  } else {
    // Let watcher run until it triggers or times out.
    deps.scheduleCleanup(() => cleanup(), maxWaitMs)
  }
}
