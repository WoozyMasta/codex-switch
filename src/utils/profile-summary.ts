import { ProfileSummary } from '../types'

const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseProfileId(value: unknown): string | null {
  const id = asOptionalString(value)
  if (!id || !PROFILE_ID_PATTERN.test(id)) {
    return null
  }
  return id
}

function parseProfileTimestamp(value: unknown): string | null {
  const timestamp = asOptionalString(value)
  if (!timestamp) {
    return null
  }

  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return new Date(parsed).toISOString()
}

export function parseProfileSummary(value: unknown): ProfileSummary | null {
  const profile = asObject(value)
  if (!profile) {
    return null
  }

  const id = parseProfileId(profile.id)
  const name = asOptionalString(profile.name)
  const email = asOptionalString(profile.email)
  const planType = asOptionalString(profile.planType)
  const createdAt = parseProfileTimestamp(profile.createdAt)
  const updatedAt = parseProfileTimestamp(profile.updatedAt)
  if (!id || !name || !email || !planType || !createdAt || !updatedAt) {
    return null
  }

  return {
    id,
    name,
    email,
    planType,
    accountId: asOptionalString(profile.accountId),
    defaultOrganizationId: asOptionalString(profile.defaultOrganizationId),
    defaultOrganizationTitle: asOptionalString(
      profile.defaultOrganizationTitle,
    ),
    chatgptUserId: asOptionalString(profile.chatgptUserId),
    userId: asOptionalString(profile.userId),
    subject: asOptionalString(profile.subject),
    createdAt,
    updatedAt,
  }
}
