import * as vscode from 'vscode'
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

interface CodexHomeManagerDeps {
  codexHomeEnabled?: boolean
  useWslAuthPath?: boolean
}

export class CodexHomeManager {
  private readonly initialCodexHome = process.env.CODEX_HOME
  private readonly codexHomeEnabled: boolean
  private readonly useWslAuthPath: boolean
  private readonly activeHome: ResolvedCodexHome
  private readonly wslCustomHomeUnsupported: boolean

  constructor(deps: CodexHomeManagerDeps = {}) {
    this.codexHomeEnabled = deps.codexHomeEnabled ?? false
    this.useWslAuthPath = deps.useWslAuthPath ?? shouldUseWslAuthPath()
    this.activeHome = this.resolveActiveHome()
    this.wslCustomHomeUnsupported =
      process.platform === 'win32' &&
      this.useWslAuthPath &&
      this.activeHome.source === 'environment' &&
      !this.activeHome.isDefault
  }

  isEnabled(): boolean {
    return this.codexHomeEnabled
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
      authPath: getDefaultCodexAuthPathForHome(fsPath, {
        useWslAuthPath: this.useWslAuthPath,
      }),
      source: this.initialCodexHome ? 'environment' : 'default',
      isDefault,
      usesPerHomeState: usePerHomeState,
    }
  }

  getActiveHome(): ResolvedCodexHome {
    return this.activeHome
  }

  buildLoginCommand(home = this.activeHome): string {
    if (this.useWslAuthPath && home.isDefault) {
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
