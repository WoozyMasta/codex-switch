import { constants, Dirent, existsSync, readdirSync, accessSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const CODEX_CLI_FILENAMES =
  process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
const NPM_BIN_DIRECTORY = 'npm'

export interface CodexCliCommand {
  command: string
  args: string[]
  useShell?: boolean
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

  if (path.isAbsolute(configuredPath) && !isExecutableFile(configuredPath)) {
    return null
  }

  return createCodexCommand(configuredPath, {
    useShellForWindowsCommandName:
      process.platform === 'win32' && !path.isAbsolute(configuredPath),
  })
}

function createCodexCommand(
  executable: string,
  options: { useShellForWindowsCommandName?: boolean } = {},
): CodexCliCommand {
  if (
    process.platform === 'win32' &&
    executable.toLowerCase().endsWith('.cmd')
  ) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${executable}" app-server`],
    }
  }

  return {
    command: executable,
    args: ['app-server'],
    useShell: options.useShellForWindowsCommandName,
  }
}

function findCodexExecutable(): string | null {
  for (const dir of getCodexSearchDirectories()) {
    for (const filename of CODEX_CLI_FILENAMES) {
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

function isSamePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
}
