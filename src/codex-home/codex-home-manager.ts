import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import { ResolvedCodexHome } from '../types'
import { getDefaultCodexAuthPathForHome } from '../auth/auth-manager'

/**
 * Computes a 16-character SHA256-based hash for a path string.
 * @param value - The string to hash.
 * @returns A 16-character hex hash.
 * @internal
 */
function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/**
 * Normalizes a path for use as an ID, resolving relative paths and
 * converting to lowercase on Windows.
 * @param value - The path to normalize.
 * @returns The normalized path.
 * @internal
 */
function normalizePathForId(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Dependencies for CodexHomeManager.
 */
interface CodexHomeManagerDeps {
  /** Optional initial Codex home path from environment or config. */
  initialCodexHome?: string
  /** Whether per-Codex-home profile management is enabled. */
  codexHomeEnabled?: boolean
  /** Whether to use WSL paths for auth on Windows. */
  useWslAuthPath?: boolean
}

/**
 * Manages the active Codex home directory configuration and switching.
 * Handles resolution of the home path, auth file path, and per-home state scoping.
 */
export class CodexHomeManager {
  private readonly initialCodexHome: string | undefined
  private readonly codexHomeEnabled: boolean
  private readonly useWslAuthPath: boolean
  private readonly activeHome: ResolvedCodexHome
  private readonly wslCustomHomeUnsupported: boolean

  /**
   * Creates a new CodexHomeManager instance.
   * @param deps - Dependencies for home directory management.
   */
  constructor(deps: CodexHomeManagerDeps = {}) {
    this.initialCodexHome = deps.initialCodexHome
    this.codexHomeEnabled = deps.codexHomeEnabled ?? false
    this.useWslAuthPath = deps.useWslAuthPath ?? false
    this.activeHome = this.resolveActiveHome()
    this.wslCustomHomeUnsupported =
      process.platform === 'win32' &&
      this.useWslAuthPath &&
      this.activeHome.source === 'environment' &&
      !this.activeHome.isDefault
  }

  /**
   * Checks if per-Codex-home profile management is enabled.
   * @returns True if multiple Codex homes are supported, false if all profiles share one home.
   */
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

  /**
   * Gets the currently active Codex home configuration.
   * @returns The resolved Codex home with paths and metadata.
   */
  getActiveHome(): ResolvedCodexHome {
    return this.activeHome
  }

  /**
   * Builds the command string to run `codex login` in the appropriate environment.
   * On Windows with WSL, uses the WSL command for the default home.
   * @param home - The home to build the login command for; defaults to the active home.
   * @returns The command string to execute.
   */
  buildLoginCommand(home = this.activeHome): string {
    if (this.useWslAuthPath && home.isDefault) {
      return 'wsl codex login'
    }

    return 'codex login'
  }

  /**
   * Creates a new terminal for running Codex commands.
   * Sets the CODEX_HOME environment variable if a non-default home is specified.
   * @param name - Name for the terminal; defaults to 'Codex Login'.
   * @param home - The Codex home to use; defaults to the active home.
   * @returns A new VS Code terminal.
   */
  createCodexTerminal(
    name = 'Codex Login',
    home?: ResolvedCodexHome,
  ): vscode.Terminal {
    return vscode.window.createTerminal({
      name,
      env: home ? { CODEX_HOME: home.fsPath } : undefined,
    })
  }

  /**
   * Checks if using a custom Codex home with WSL is unsupported in this configuration.
   * @returns True if custom homes are not supported with WSL on this system.
   */
  isWslCustomHomeUnsupported(): boolean {
    return this.wslCustomHomeUnsupported
  }
}
