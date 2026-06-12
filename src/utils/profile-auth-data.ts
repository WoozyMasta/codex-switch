import type { AuthData, ProfileSummary } from '../types'
import type { ProfileTokens } from './profile-records'
import { asOptionalString, firstDefinedString } from './strings'

export interface ProfileAuthExtraction {
  idToken?: string
  accessToken?: string
  refreshToken?: string
  accountId?: string
  defaultOrganizationId?: string
  defaultOrganizationTitle?: string
  chatgptUserId?: string
  userId?: string
  subject?: string
  email?: string
  planType?: string
  authJson?: Record<string, unknown>
}

function chooseString(...values: unknown[]): string | undefined {
  return firstDefinedString(...values.map((value) => asOptionalString(value)))
}

export function buildProfileAuthData(
  profile: ProfileSummary,
  tokens: ProfileTokens,
  extracted: ProfileAuthExtraction | null | undefined,
): AuthData | null {
  const idToken = chooseString(extracted?.idToken, tokens.idToken)
  const accessToken = chooseString(extracted?.accessToken, tokens.accessToken)
  const refreshToken = chooseString(
    extracted?.refreshToken,
    tokens.refreshToken,
  )
  if (!idToken || !accessToken || !refreshToken) {
    return null
  }

  const email = chooseString(extracted?.email, profile.email)
  const planType = chooseString(extracted?.planType, profile.planType)
  if (!email || !planType) {
    return null
  }

  return {
    idToken,
    accessToken,
    refreshToken,
    accountId: chooseString(
      extracted?.accountId,
      tokens.accountId,
      profile.accountId,
    ),
    defaultOrganizationId: chooseString(
      extracted?.defaultOrganizationId,
      profile.defaultOrganizationId,
    ),
    defaultOrganizationTitle: chooseString(
      extracted?.defaultOrganizationTitle,
      profile.defaultOrganizationTitle,
    ),
    chatgptUserId: chooseString(
      extracted?.chatgptUserId,
      profile.chatgptUserId,
    ),
    userId: chooseString(extracted?.userId, profile.userId),
    subject: chooseString(extracted?.subject, profile.subject),
    email,
    planType,
    authJson: extracted?.authJson ? extracted.authJson : tokens.authJson,
  }
}
