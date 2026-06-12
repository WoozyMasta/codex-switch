import type { ResolvedCodexHome } from '../types'

export function shouldMigrateLegacyProfileState(
  home: ResolvedCodexHome,
): boolean {
  return !home.usesPerHomeState || home.isDefault
}

export function isNonDefaultPerHomeState(home: ResolvedCodexHome): boolean {
  return home.usesPerHomeState && !home.isDefault
}
