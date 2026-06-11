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
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export class CodexHomeManager {
  private readonly initialCodexHome = process.env.CODEX_HOME
  private readonly activeHome = this.resolveActiveHome()
  private readonly wslCustomHomeUnsupported =
    process.platform === 'win32' &&
    shouldUseWslAuthPath() &&
    this.activeHome.source === 'environment' &&
    !this.activeHome.isDefault

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

  private resolveActiveHome(): ResolvedCodexHome {
    const fallbackHome = path.join(os.homedir(), '.codex')
    const envValue = this.initialCodexHome || fallbackHome
    const fsPath = path.resolve(envValue)
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
      envValue,
      authPath: getDefaultCodexAuthPathForHome(fsPath),
      source: this.initialCodexHome ? 'environment' : 'default',
      isDefault,
      usesPerHomeState: usePerHomeState,
    }
  }

  getActiveHome(): ResolvedCodexHome {
    return this.activeHome
  }

  ensureActiveHome(): ResolvedCodexHome {
    const home = this.activeHome
    fs.mkdirSync(home.fsPath, { recursive: true, mode: 0o700 })
    return home
  }

  buildLoginCommand(home = this.activeHome): string {
    if (shouldUseWslAuthPath() && home.isDefault) {
      return 'wsl codex login'
    }

    return 'codex login'
  }

  createCodexTerminal(
    name = 'Codex Login',
    home?: ResolvedCodexHome,
  ): vscode.Terminal {
    return vscode.window.createTerminal({
      name,
      env: home ? { CODEX_HOME: home.fsPath } : undefined,
    })
  }

  isWslCustomHomeUnsupported(): boolean {
    return this.wslCustomHomeUnsupported
  }
}
