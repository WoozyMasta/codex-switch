export interface ProfileSecretKeys {
  current: string
  legacy: string
}

const CURRENT_SECRET_PREFIX = 'codexSwitch.profile.'
const LEGACY_SECRET_PREFIX = 'codexUsage.profile.'

export function buildProfileSecretKeys(profileId: string): ProfileSecretKeys {
  return {
    current: `${CURRENT_SECRET_PREFIX}${profileId}`,
    legacy: `${LEGACY_SECRET_PREFIX}${profileId}`,
  }
}
