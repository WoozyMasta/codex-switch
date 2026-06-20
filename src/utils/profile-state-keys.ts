/** Storage keys for active and last profile state. */
export interface ProfileStateKeys {
  /** Key for the currently active profile ID. */
  active: string
  /** Key for the last used profile ID. */
  last: string
}

/** Generates storage keys scoped to a specific home directory. */
export function buildProfileStateKeys(homeId: string): ProfileStateKeys {
  return {
    active: `codexSwitch.activeProfileId.${homeId}`,
    last: `codexSwitch.lastProfileId.${homeId}`,
  }
}
