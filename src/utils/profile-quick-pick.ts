import type { ProfileSummary } from '../types'
import { formatProfileEmailDescription } from './profile-email'

export interface ProfileQuickPickItem {
  label: string
  description?: string
  detail?: string
  profileId: string
}

export function buildProfileListQuickPickItems(
  profiles: ProfileSummary[],
): ProfileQuickPickItem[] {
  return profiles.map((profile) => ({
    label: profile.name,
    description: formatProfileEmailDescription(profile.email),
    profileId: profile.id,
  }))
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
      formatProfileEmailDescription(profile.email),
      profile.id === activeProfileId ? activeLabel : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' • '),
    profileId: profile.id,
  }))
}
