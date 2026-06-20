import type { ProfileRateLimits, ProfileSummary } from '../types'

/** UUID v1-v5 pattern validation for profile IDs. */
const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Safely casts an unknown value to a plain object, or null if invalid. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** Converts an unknown value to a trimmed string or undefined if not a valid string. */
function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** Validates and returns a UUID, or null if the value doesn't match the UUID pattern. */
function parseProfileId(value: unknown): string | null {
  const id = asOptionalString(value)
  if (!id || !PROFILE_ID_PATTERN.test(id)) {
    return null
  }
  return id
}

/** Parses and normalizes a timestamp to ISO string format, or null if invalid. */
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

/** Parses a rate limit window object with usage and reset time, or undefined if invalid. */
function parseProfileRateLimitWindow(
  value: unknown,
): ProfileRateLimits['fiveHour'] | undefined {
  if (value === null) {
    return null
  }
  const window = asObject(value)
  if (!window) {
    return undefined
  }

  const usedPercent = window.usedPercent
  const remainingPercent = window.remainingPercent
  const resetsAt = window.resetsAt
  if (
    typeof usedPercent !== 'number' ||
    !Number.isFinite(usedPercent) ||
    typeof remainingPercent !== 'number' ||
    !Number.isFinite(remainingPercent)
  ) {
    return undefined
  }
  if (
    resetsAt !== undefined &&
    resetsAt !== null &&
    (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt))
  ) {
    return undefined
  }

  return { usedPercent, remainingPercent, resetsAt: resetsAt ?? undefined }
}

/** Parses profile rate limits with fiveHour and weekly windows, handling null/undefined states. */
function parseProfileRateLimits(
  value: unknown,
): ProfileRateLimits | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }

  const rateLimits = asObject(value)
  if (!rateLimits) {
    return undefined
  }

  const fiveHour = parseProfileRateLimitWindow(rateLimits.fiveHour)
  const weekly = parseProfileRateLimitWindow(rateLimits.weekly)
  if (fiveHour === undefined || weekly === undefined) {
    return undefined
  }

  return {
    fiveHour,
    weekly,
  }
}

/** Parses and validates a complete profile summary from an unknown value, returning null if invalid. */
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
  const hasRateLimits = Object.prototype.hasOwnProperty.call(
    profile,
    'rateLimits',
  )
  const rateLimits = parseProfileRateLimits(profile.rateLimits)
  if (
    !id ||
    !name ||
    !email ||
    !planType ||
    !createdAt ||
    !updatedAt ||
    (hasRateLimits && rateLimits === undefined)
  ) {
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
    rateLimits,
  }
}
