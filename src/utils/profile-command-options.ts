import { join as pathJoin } from 'path'

export type StatusBarClickBehavior = 'cycle' | 'toggleLast' | 'selector'

export function resolveStatusBarClickBehavior(
  raw: StatusBarClickBehavior | string | undefined | null,
): StatusBarClickBehavior {
  if (raw === 'toggleLast') {
    return 'toggleLast'
  }
  if (raw === 'selector') {
    return 'selector'
  }
  return 'cycle'
}

export function resolveDefaultSettingsExportPath(
  workspacePath: string | undefined,
  homeDir: string,
): string {
  const baseDir = workspacePath || homeDir
  return pathJoin(baseDir, 'codex-switch-profiles.json')
}
