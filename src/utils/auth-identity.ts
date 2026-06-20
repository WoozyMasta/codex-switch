/** Describes how closely two identity snapshots match (if at all). */
export type IdentityMatch = 'exact' | 'different' | 'ambiguous'

/** Normalized and comparable identity fields from an authentication snapshot. */
export interface IdentitySnapshot {
  /** Organization ID. */
  organizationId?: string
  /** ChatGPT-specific user ID. */
  chatgptUserId?: string
  /** General user ID. */
  userId?: string
  /** OpenID Connect subject. */
  subject?: string
  /** Account ID. */
  accountId?: string
  /** Email address (normalized to lowercase, empty if 'unknown'). */
  email?: string
}

/** Identity fields from an authentication source (typically from AuthData). */
export interface IdentitySource {
  /** Default organization ID. */
  defaultOrganizationId?: string
  /** ChatGPT-specific user ID. */
  chatgptUserId?: string
  /** General user ID. */
  userId?: string
  /** OpenID Connect subject. */
  subject?: string
  /** Account ID. */
  accountId?: string
  /** Email address. */
  email?: string
}

function normalizeIdentity(value: string | undefined): string {
  return String(value || '').trim()
}

function normalizeComparableEmail(email: string | undefined): string {
  const normalized = normalizeIdentity(email).toLowerCase()
  return normalized && normalized !== 'unknown' ? normalized : ''
}

function compareIdentityValue(
  left: string | undefined,
  right: string | undefined,
): 'match' | 'different' | 'ambiguous' | 'unknown' {
  const normalizedLeft = normalizeIdentity(left)
  const normalizedRight = normalizeIdentity(right)

  if (!normalizedLeft && !normalizedRight) {
    return 'unknown'
  }

  if (!normalizedLeft || !normalizedRight) {
    return 'ambiguous'
  }

  return normalizedLeft === normalizedRight ? 'match' : 'different'
}

function compareIdentityGroup(
  left: IdentitySnapshot,
  right: IdentitySnapshot,
  keys: Array<keyof IdentitySnapshot>,
): 'match' | 'different' | 'ambiguous' | 'unknown' {
  let sawMatch = false
  let sawAmbiguous = false

  for (const key of keys) {
    const state = compareIdentityValue(left[key], right[key])
    if (state === 'different') {
      return 'different'
    }
    if (state === 'match') {
      sawMatch = true
    } else if (state === 'ambiguous') {
      sawAmbiguous = true
    }
  }

  if (sawMatch) {
    return 'match'
  }
  if (sawAmbiguous) {
    return 'ambiguous'
  }
  return 'unknown'
}

/** Converts an IdentitySource into a normalized IdentitySnapshot for comparison. */
export function buildIdentitySnapshot(
  source: IdentitySource,
): IdentitySnapshot {
  return {
    organizationId: normalizeIdentity(source.defaultOrganizationId),
    chatgptUserId: normalizeIdentity(source.chatgptUserId),
    userId: normalizeIdentity(source.userId),
    subject: normalizeIdentity(source.subject),
    accountId: normalizeIdentity(source.accountId),
    email: normalizeComparableEmail(source.email),
  }
}

/** Compares two identity snapshots and returns whether they match exactly, partially, ambiguously, or differ. */
export function compareIdentitySnapshots(
  left: IdentitySnapshot,
  right: IdentitySnapshot,
): IdentityMatch {
  const organizationState = compareIdentityValue(
    left.organizationId,
    right.organizationId,
  )
  if (organizationState === 'different') {
    return 'different'
  }

  const strongState = compareIdentityGroup(left, right, [
    'chatgptUserId',
    'userId',
    'subject',
  ])
  if (strongState === 'different') {
    return 'different'
  }
  if (strongState === 'match') {
    return organizationState === 'ambiguous' ? 'ambiguous' : 'exact'
  }

  const weakState = compareIdentityGroup(left, right, ['accountId', 'email'])
  if (weakState === 'different') {
    return 'different'
  }
  if (weakState === 'match') {
    return organizationState === 'ambiguous' ? 'ambiguous' : 'exact'
  }

  if (
    organizationState === 'ambiguous' ||
    strongState === 'ambiguous' ||
    weakState === 'ambiguous'
  ) {
    return 'ambiguous'
  }

  return 'ambiguous'
}
