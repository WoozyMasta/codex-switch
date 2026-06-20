import { join as pathJoin } from 'path'

/** Behavior mode for status bar click: cycle through profiles, toggle to last, or show selector. */
export type StatusBarClickBehavior = 'cycle' | 'toggleLast' | 'selector'

/** Parses and validates status bar click behavior, defaulting to 'cycle' if invalid. */
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

/** Resolves default export path for settings, using workspace root or home directory. */
export function resolveDefaultSettingsExportPath(
  workspacePath: string | undefined,
  homeDir: string,
): string {
  const baseDir = workspacePath || homeDir
  return pathJoin(baseDir, 'codex-switch-profiles.json')
}
