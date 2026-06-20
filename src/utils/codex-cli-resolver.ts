import {
  accessSync,
  constants,
  Dirent,
  existsSync,
  readdirSync,
  statSync,
} from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

/** Standard npm bin directory name. */
const NPM_BIN_DIRECTORY = 'npm'

/** Represents a resolved Codex CLI command with executable path and arguments. */
export interface CodexCliCommand {
  /** Path to the executable or command name. */
  command: string
  /** Arguments to pass to the command. */
  args: string[]
}

/** Optional dependencies for testing and platform abstraction. */
export interface CodexCliResolverDeps {
  /** Process environment variables (defaults to process.env). */
  env?: typeof process.env
  /** Platform identifier (defaults to process.platform). */
  platform?: typeof process.platform
}

/** Resolves the Codex CLI command by checking configuration or finding the executable in PATH. */
export function resolveCodexCliCommand(
  deps: CodexCliResolverDeps = {},
): CodexCliCommand | null {
  const configuredCodexCommand = resolveConfiguredCodexCommand(deps)
  if (configuredCodexCommand) {
    return configuredCodexCommand
  }

  const executable = findCodexExecutable(deps)
  return executable ? createCodexCommand(executable, deps) : null
}

/** Checks for a user-configured Codex CLI path in VS Code settings. */
function resolveConfiguredCodexCommand(
  deps: CodexCliResolverDeps,
): CodexCliCommand | null {
  const configuredPath = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<string>('codexCliPath', '')
    .trim()

  if (!configuredPath) {
    return null
  }

  const executable = resolveConfiguredCodexExecutable(configuredPath, deps)
  if (!executable) {
    return null
  }

  return createCodexCommand(executable, deps)
}

/** Validates and resolves a configured Codex CLI path, returning the executable or null. */
function resolveConfiguredCodexExecutable(
  configuredPath: string,
  deps: CodexCliResolverDeps,
): string | null {
  const candidate = configuredPath.trim()
  if (!candidate) {
    return null
  }

  if (isPathLike(candidate)) {
    const resolvedPath = path.resolve(candidate)
    return isExecutableFile(resolvedPath) ? resolvedPath : null
  }

  return findCodexExecutable(deps, candidate)
}

/** Constructs a CodexCliCommand with platform-specific handling for Windows batch files. */
function createCodexCommand(
  executable: string,
  deps: CodexCliResolverDeps,
): CodexCliCommand {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  if (platform === 'win32' && executable.toLowerCase().endsWith('.cmd')) {
    return {
      command: env.ComSpec || 'cmd.exe',
      // Keep the batch command shape fixed. Only the resolved absolute path is
      // interpolated, and it is quoted before cmd.exe sees it.
      args: [
        '/d',
        '/v:off',
        '/s',
        '/c',
        `${quoteWindowsCmdArgument(executable)} app-server`,
      ],
    }
  }

  return {
    command: executable,
    args: ['app-server'],
  }
}

/** Searches for a Codex executable in PATH and common install directories. */
function findCodexExecutable(
  deps: CodexCliResolverDeps,
  commandName = 'codex',
): string | null {
  const candidateNames = buildExecutableCandidateNames(commandName, deps)
  for (const dir of getCodexSearchDirectories(deps)) {
    for (const filename of candidateNames) {
      const candidate = path.join(dir, filename)
      if (isExecutableFile(candidate)) {
        return candidate
      }
    }
  }

  return null
}

/** Collects all directories to search for Codex CLI, including PATH and platform-specific locations. */
function getCodexSearchDirectories(deps: CodexCliResolverDeps): string[] {
  const env = deps.env ?? process.env
  const dirs: string[] = []
  const addDir = (dir: string | undefined) => {
    if (dir && !dirs.some((existing) => isSamePath(existing, dir))) {
      dirs.push(dir)
    }
  }

  for (const dir of (env.PATH || '').split(path.delimiter)) {
    addDir(dir)
  }

  addCommonCodexSearchDirectories(addDir, deps)

  for (const dir of getBundledCodexSearchDirectories(deps)) {
    addDir(dir)
  }

  return dirs
}

/** Generates platform-appropriate executable names, adding .exe and .cmd variants on Windows. */
function buildExecutableCandidateNames(
  commandName: string,
  deps: CodexCliResolverDeps,
): string[] {
  const names = [commandName]

  if ((deps.platform ?? process.platform) === 'win32') {
    const lower = commandName.toLowerCase()
    if (!lower.endsWith('.exe') && !lower.endsWith('.cmd')) {
      names.push(`${commandName}.exe`, `${commandName}.cmd`)
    }
  }

  return names
}

/** Checks if a string represents a path-like pattern (absolute, relative, or with separators). */
function isPathLike(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.startsWith('.') ||
    value.includes(path.sep) ||
    (path.sep !== path.posix.sep && value.includes(path.posix.sep)) ||
    /^[a-zA-Z]:[\\/]/.test(value)
  )
}

/** Adds standard installation directories for Codex CLI across platforms. */
function addCommonCodexSearchDirectories(
  addDir: (dir: string | undefined) => void,
  deps: CodexCliResolverDeps,
): void {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  addDir(path.join(os.homedir(), '.codex', 'bin'))
  addDir(path.join(os.homedir(), '.local', 'bin'))
  addDir(path.join(os.homedir(), '.cargo', 'bin'))

  if (platform === 'win32') {
    addDir(env.APPDATA && path.join(env.APPDATA, NPM_BIN_DIRECTORY))
    addDir(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, NPM_BIN_DIRECTORY))
    addDir(path.join(os.homedir(), 'AppData', 'Roaming', NPM_BIN_DIRECTORY))
    addDir(path.join(os.homedir(), 'AppData', 'Local', NPM_BIN_DIRECTORY))
    addDir(env.ProgramFiles && path.join(env.ProgramFiles, 'nodejs'))
    addDir(
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'nodejs'),
    )
    return
  }

  addDir('/opt/homebrew/bin')
  addDir('/usr/local/bin')
  addDir('/usr/bin')
}

/** Searches for Codex CLI bundled with VS Code extensions (Windows only). */
function getBundledCodexSearchDirectories(
  deps: CodexCliResolverDeps,
): string[] {
  if ((deps.platform ?? process.platform) !== 'win32') {
    return []
  }

  const extensionRoots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
    path.join(os.homedir(), '.vscode-oss', 'extensions'),
  ]
  const candidates: BundledCodexCandidate[] = []

  for (const root of extensionRoots) {
    if (!existsSync(root)) {
      continue
    }

    try {
      for (const entry of readdirSync(root, {
        withFileTypes: true,
      }) as Dirent[]) {
        if (!entry.isDirectory()) {
          continue
        }

        if (!entry.name.toLowerCase().startsWith('openai.chatgpt-')) {
          continue
        }

        candidates.push({
          extensionName: entry.name,
          binaryDirectory: path.join(root, entry.name, 'bin', 'windows-x86_64'),
        })
      }
    } catch {
      // Ignore optional bundled CLI discovery failures.
    }
  }

  return candidates
    .sort(compareBundledCodexCandidates)
    .map((candidate) => candidate.binaryDirectory)
}

/** Candidate for a bundled Codex CLI from a VS Code extension. */
interface BundledCodexCandidate {
  /** Name of the VS Code extension directory. */
  extensionName: string
  /** Path to the binary directory. */
  binaryDirectory: string
}

/** Compares bundled Codex candidates by version (descending) then by name. */
function compareBundledCodexCandidates(
  left: BundledCodexCandidate,
  right: BundledCodexCandidate,
): number {
  const leftVersion = extractVersionFromBundledExtensionName(left.extensionName)
  const rightVersion = extractVersionFromBundledExtensionName(
    right.extensionName,
  )

  if (leftVersion && rightVersion) {
    const versionComparison = compareVersionParts(leftVersion, rightVersion)
    if (versionComparison !== 0) {
      return versionComparison * -1
    }
  } else if (leftVersion || rightVersion) {
    return leftVersion ? -1 : 1
  }

  return left.extensionName.localeCompare(right.extensionName)
}

/** Extracts semantic version numbers from a bundled extension name, or null if not found. */
function extractVersionFromBundledExtensionName(
  extensionName: string,
): number[] | null {
  const match = extensionName.match(/-(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    return null
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10))
}

/** Compares two semantic version arrays component-wise, returning -1, 0, or 1. */
function compareVersionParts(left: number[], right: number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const leftPart = left[i] ?? 0
    const rightPart = right[i] ?? 0
    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

/** Checks if a file exists and is executable (with platform-specific handling). */
function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }

  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      return false
    }
  } catch {
    return false
  }

  if (process.platform === 'win32') {
    return true
  }

  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Escapes and quotes a string for safe use with Windows cmd.exe. */
function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replace(/%/g, '%%')}"`
}

/** Compares two paths for equality, normalizing and lowercasing for cross-platform consistency. */
function isSamePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
}
