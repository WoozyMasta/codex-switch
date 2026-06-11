import { homedir } from 'os'
import { join, resolve } from 'path'

export function resolveDefaultCodexHomePath(
  codexHomeEnvValue: string | undefined,
  homeDir: string = homedir(),
): string {
  return resolve(codexHomeEnvValue || join(homeDir, '.codex'))
}

export function getCodexAuthPathForHome(codexHomePath: string): string {
  return join(resolve(codexHomePath), 'auth.json')
}
