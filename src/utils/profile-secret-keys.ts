/** Secret storage keys for accessing profile authentication data. */
export interface ProfileSecretKeys {
  /** Key for current storage format. */
  current: string
  /** Key for legacy storage format. */
  legacy: string
}

/** Prefix for current secret key format. */
const CURRENT_SECRET_PREFIX = 'codexSwitch.profile.'
/** Prefix for legacy secret key format. */
const LEGACY_SECRET_PREFIX = 'codexUsage.profile.'

/** Generates secret storage keys for a specific profile ID using both current and legacy prefixes. */
export function buildProfileSecretKeys(profileId: string): ProfileSecretKeys {
  return {
    current: `${CURRENT_SECRET_PREFIX}${profileId}`,
    legacy: `${LEGACY_SECRET_PREFIX}${profileId}`,
  }
}
