import type { ResolvedCodexHome } from '../types'

/** Determines if legacy global profile state should be migrated, for non-per-home or default home. */
export function shouldMigrateLegacyProfileState(
  home: ResolvedCodexHome,
): boolean {
  return !home.usesPerHomeState || home.isDefault
}

/** Checks if this home uses per-home state and is not the default home. */
export function isNonDefaultPerHomeState(home: ResolvedCodexHome): boolean {
  return home.usesPerHomeState && !home.isDefault
}
