import type { AuthData, ProfileSummary } from '../types'
import type { ProfileTokens } from './profile-records'
import { asOptionalString, firstDefinedString } from './strings'

/** Partial authentication data extracted from an external or legacy source. */
export interface ProfileAuthExtraction {
  /** OpenID Connect identity token. */
  idToken?: string
  /** OAuth2 access token. */
  accessToken?: string
  /** OAuth2 refresh token. */
  refreshToken?: string
  /** Account ID from extraction. */
  accountId?: string
  /** Default organization ID from extraction. */
  defaultOrganizationId?: string
  /** Default organization title from extraction. */
  defaultOrganizationTitle?: string
  /** ChatGPT user ID from extraction. */
  chatgptUserId?: string
  /** User ID from extraction. */
  userId?: string
  /** Subject claim from extraction. */
  subject?: string
  /** Email address from extraction. */
  email?: string
  /** Plan type from extraction. */
  planType?: string
  /** Complete auth.json object from extraction. */
  authJson?: Record<string, unknown>
}

/** Selects the first defined string from a list of values after sanitization. */
function chooseString(...values: unknown[]): string | undefined {
  return firstDefinedString(...values.map((value) => asOptionalString(value)))
}

/** Merges profile, tokens, and extracted data into complete AuthData, returning null if required fields are missing. */
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
