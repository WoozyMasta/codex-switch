import type * as fs from 'fs'
import type * as fsPromises from 'fs/promises'
import type * as vscode from 'vscode'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import type { CodexCliCommand } from '../utils/codex-cli-resolver'

export type Clock = () => number
export type ProcessEnv = typeof process.env
export type ConfigurationGetter = typeof vscode.workspace.getConfiguration
export type StateStore = Pick<vscode.Memento, 'get' | 'update'>
export type SecretStorageStore = Pick<
  vscode.SecretStorage,
  'get' | 'store' | 'delete'
>
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
export type AsyncFileSystem = Pick<
  typeof fsPromises,
  'mkdtemp' | 'chmod' | 'writeFile' | 'unlink' | 'rm'
>
export type SpawnAppServer = (
  codexCommand: CodexCliCommand,
  env: Record<string, string | undefined>,
) => ChildProcessWithoutNullStreams
