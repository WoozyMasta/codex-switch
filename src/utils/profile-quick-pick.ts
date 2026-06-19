import type { ProfileSummary } from '../types'

export interface ProfileQuickPickItem {
  label: string
  description?: string
  detail: string
  profileId: string
}

export function buildProfileSwitchQuickPickItems(
  profiles: ProfileSummary[],
  activeProfileId: string | undefined,
  activeLabel: string,
  formatDescription: (profile: ProfileSummary) => string,
): ProfileQuickPickItem[] {
  return profiles.map((profile) => ({
    label: profile.name,
    description: formatDescription(profile),
    detail: [
      profile.email && profile.email !== 'Unknown' ? profile.email : undefined,
      profile.id === activeProfileId ? activeLabel : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' • '),
    profileId: profile.id,
  }))
}
