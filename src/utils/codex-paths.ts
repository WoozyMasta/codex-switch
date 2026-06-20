import { homedir } from 'os'
import { join, resolve } from 'path'

/** Resolves the Codex home directory path from env or defaults to ~/.codex. */
export function resolveDefaultCodexHomePath(
  codexHomeEnvValue: string | undefined,
  homeDir: string = homedir(),
): string {
  return resolve(codexHomeEnvValue || join(homeDir, '.codex'))
}

/** Returns the path to auth.json within a given Codex home directory. */
export function getCodexAuthPathForHome(codexHomePath: string): string {
  return join(resolve(codexHomePath), 'auth.json')
}
