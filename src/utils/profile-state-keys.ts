export interface ProfileStateKeys {
  active: string
  last: string
}

export function buildProfileStateKeys(homeId: string): ProfileStateKeys {
  return {
    active: `codexSwitch.activeProfileId.${homeId}`,
    last: `codexSwitch.lastProfileId.${homeId}`,
  }
}
