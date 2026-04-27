import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import { ResolvedCodexHome } from '../types'
import {
  getDefaultCodexAuthPathForHome,
  shouldUseWslAuthPath,
} from '../auth/auth-manager'

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function normalizePathForId(value: string): string {
  return path.resolve(value).toLowerCase()
}

export class CodexHomeManager {
  private readonly initialCodexHome = process.env.CODEX_HOME

  constructor() {}

  private getConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('codexSwitch')
  }

  isEnabled(): boolean {
    return this.getConfiguration().get<boolean>('codexHome.enabled', false)
  }

  setActiveProfileId(_profileId: string | undefined): void {
    // Kept for ProfileManager compatibility; CODEX_HOME resolution is
    // intentionally based only on the environment VS Code was launched with.
  }

  getActiveHome(): ResolvedCodexHome {
    const fallbackHome = path.join(os.homedir(), '.codex')
    const fsPath = this.initialCodexHome || fallbackHome
    const normalizedHome = normalizePathForId(fsPath)
    const normalizedFallback = normalizePathForId(fallbackHome)
    const isDefault = normalizedHome === normalizedFallback
    const usePerHomeState = this.isEnabled()

    return {
      id:
        usePerHomeState && !isDefault
          ? `env-${hashValue(normalizedHome)}`
          : 'default',
      name: isDefault ? 'default' : path.basename(fsPath) || 'CODEX_HOME',
      fsPath,
      envValue: fsPath,
      authPath: getDefaultCodexAuthPathForHome(fsPath),
      source: this.initialCodexHome ? 'environment' : 'default',
      isDefault,
      usesPerHomeState: usePerHomeState,
    }
  }

  ensureActiveHome(): ResolvedCodexHome {
    const home = this.getActiveHome()
    fs.mkdirSync(home.fsPath, { recursive: true, mode: 0o700 })
    return home
  }

  buildLoginCommand(): string {
    return shouldUseWslAuthPath() ? 'wsl codex login' : 'codex login'
  }

  createCodexTerminal(name = 'Codex Login'): vscode.Terminal {
    return vscode.window.createTerminal(name)
  }
}
