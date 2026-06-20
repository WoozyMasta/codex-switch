import type * as fs from 'fs'
import type * as fsPromises from 'fs/promises'
import type * as vscode from 'vscode'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import type { CodexCliCommand } from '../utils/codex-cli-resolver'

/** Function type that returns the current time in milliseconds. */
export type Clock = () => number

/** Type for accessing process environment variables. */
export type ProcessEnv = typeof process.env

/** Type for accessing VS Code configuration. */
export type ConfigurationGetter = typeof vscode.workspace.getConfiguration

/** Type for VS Code state storage with get and update methods. */
export type StateStore = Pick<vscode.Memento, 'get' | 'update'>

/** Type for VS Code secure secret storage. */
export type SecretStorageStore = Pick<
  vscode.SecretStorage,
  'get' | 'store' | 'delete'
>

/** Type for synchronous file system operations. */
export type SyncFileSystem = Pick<
  typeof fs,
  | 'existsSync'
  | 'mkdirSync'
  | 'chmodSync'
  | 'readdirSync'
  | 'readFileSync'
  | 'writeFileSync'
  | 'renameSync'
  | 'copyFileSync'
  | 'rmSync'
  | 'unlinkSync'
>

/** Type for asynchronous file system operations. */
export type AsyncFileSystem = Pick<
  typeof fsPromises,
  'mkdtemp' | 'chmod' | 'writeFile' | 'readFile' | 'unlink' | 'rm'
>

/** Function type for spawning a Codex app server process. */
export type SpawnAppServer = (
  codexCommand: CodexCliCommand,
  env: Record<string, string | undefined>,
) => ChildProcessWithoutNullStreams
