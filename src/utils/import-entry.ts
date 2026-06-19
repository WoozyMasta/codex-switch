import type { AuthData } from '../types'
import { validateImportedAuthJson } from './auth-payload'
import { buildDefaultProfileName } from './profile-names'
import { asOptionalString } from './strings'

interface ParsedImportEntry {
  sourceProfileId?: string
  name: string
  authData: AuthData
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function parseImportEntry(value: unknown): ParsedImportEntry | null {
  const entry = asObject(value)
  if (!entry) {
    return null
  }

  const profile = asObject(entry.profile)
  const tokens = asObject(entry.tokens)
  if (!profile || !tokens) {
    return null
  }

  const idToken = asOptionalString(tokens.idToken)
  const accessToken = asOptionalString(tokens.accessToken)
  const refreshToken = asOptionalString(tokens.refreshToken)
  if (!idToken || !accessToken || !refreshToken) {
    return null
  }

  const email = asOptionalString(profile.email) || 'Unknown'
  const planType = asOptionalString(profile.planType) || 'Unknown'
  const name = buildDefaultProfileName(
    asOptionalString(profile.name),
    email,
    'profile',
  )

  const authJson = asObject(tokens.authJson) || undefined
  const accountId =
    asOptionalString(tokens.accountId) || asOptionalString(profile.accountId)
  const validatedAuthJson = authJson
    ? validateImportedAuthJson(authJson, {
        idToken,
        accessToken,
        refreshToken,
        accountId,
      })
    : undefined

  if (authJson && !validatedAuthJson) {
    return null
  }

  return {
    sourceProfileId: asOptionalString(profile.id),
    name,
    authData: {
      idToken,
      accessToken,
      refreshToken,
      accountId,
      defaultOrganizationId: asOptionalString(profile.defaultOrganizationId),
      defaultOrganizationTitle: asOptionalString(
        profile.defaultOrganizationTitle,
      ),
      chatgptUserId: asOptionalString(profile.chatgptUserId),
      userId: asOptionalString(profile.userId),
      subject: asOptionalString(profile.subject),
      email,
      planType,
      authJson: validatedAuthJson ?? undefined,
    },
  }
}
