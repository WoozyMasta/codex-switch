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

const NPM_BIN_DIRECTORY = 'npm'

export interface CodexCliCommand {
  command: string
  args: string[]
}

export function resolveCodexCliCommand(): CodexCliCommand | null {
  const configuredCodexCommand = resolveConfiguredCodexCommand()
  if (configuredCodexCommand) {
    return configuredCodexCommand
  }

  const executable = findCodexExecutable()
  return executable ? createCodexCommand(executable) : null
}

function resolveConfiguredCodexCommand(): CodexCliCommand | null {
  const configuredPath = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<string>('codexCliPath', '')
    .trim()

  if (!configuredPath) {
    return null
  }

  const executable = resolveConfiguredCodexExecutable(configuredPath)
  if (!executable) {
    return null
  }

  return createCodexCommand(executable)
}

function resolveConfiguredCodexExecutable(
  configuredPath: string,
): string | null {
  const candidate = configuredPath.trim()
  if (!candidate) {
    return null
  }

  if (isPathLike(candidate)) {
    const resolvedPath = path.resolve(candidate)
    return isExecutableFile(resolvedPath) ? resolvedPath : null
  }

  return findCodexExecutable(candidate)
}

function createCodexCommand(executable: string): CodexCliCommand {
  if (
    process.platform === 'win32' &&
    executable.toLowerCase().endsWith('.cmd')
  ) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
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

function findCodexExecutable(commandName = 'codex'): string | null {
  const candidateNames = buildExecutableCandidateNames(commandName)
  for (const dir of getCodexSearchDirectories()) {
    for (const filename of candidateNames) {
      const candidate = path.join(dir, filename)
      if (isExecutableFile(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function getCodexSearchDirectories(): string[] {
  const dirs: string[] = []
  const addDir = (dir: string | undefined) => {
    if (dir && !dirs.some((existing) => isSamePath(existing, dir))) {
      dirs.push(dir)
    }
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    addDir(dir)
  }

  addCommonCodexSearchDirectories(addDir)

  for (const dir of getBundledCodexSearchDirectories()) {
    addDir(dir)
  }

  return dirs
}

function buildExecutableCandidateNames(commandName: string): string[] {
  const names = [commandName]

  if (process.platform === 'win32') {
    const lower = commandName.toLowerCase()
    if (!lower.endsWith('.exe') && !lower.endsWith('.cmd')) {
      names.push(`${commandName}.exe`, `${commandName}.cmd`)
    }
  }

  return names
}

function isPathLike(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.startsWith('.') ||
    value.includes(path.sep) ||
    (path.sep !== path.posix.sep && value.includes(path.posix.sep)) ||
    /^[a-zA-Z]:[\\/]/.test(value)
  )
}

function addCommonCodexSearchDirectories(
  addDir: (dir: string | undefined) => void,
): void {
  addDir(path.join(os.homedir(), '.codex', 'bin'))
  addDir(path.join(os.homedir(), '.local', 'bin'))
  addDir(path.join(os.homedir(), '.cargo', 'bin'))

  if (process.platform === 'win32') {
    addDir(
      process.env.APPDATA && path.join(process.env.APPDATA, NPM_BIN_DIRECTORY),
    )
    addDir(
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, NPM_BIN_DIRECTORY),
    )
    addDir(path.join(os.homedir(), 'AppData', 'Roaming', NPM_BIN_DIRECTORY))
    addDir(path.join(os.homedir(), 'AppData', 'Local', NPM_BIN_DIRECTORY))
    addDir(
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs'),
    )
    addDir(
      process.env['ProgramFiles(x86)'] &&
        path.join(process.env['ProgramFiles(x86)'], 'nodejs'),
    )
    return
  }

  addDir('/opt/homebrew/bin')
  addDir('/usr/local/bin')
  addDir('/usr/bin')
}

function getBundledCodexSearchDirectories(): string[] {
  if (process.platform !== 'win32') {
    return []
  }

  const extensionRoots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
    path.join(os.homedir(), '.vscode-oss', 'extensions'),
  ]
  const dirs: string[] = []

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

        dirs.push(path.join(root, entry.name, 'bin', 'windows-x86_64'))
      }
    } catch {
      // Ignore optional bundled CLI discovery failures.
    }
  }

  return dirs
}

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

function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replace(/%/g, '%%')}"`
}

function isSamePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
}
