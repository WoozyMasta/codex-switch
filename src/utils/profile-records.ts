import type { AuthData, ProfileSummary } from '../types'

/** Complete set of authentication tokens and metadata for a profile. */
export interface ProfileTokens {
  /** OpenID Connect identity token. */
  idToken: string
  /** OAuth2 access token. */
  accessToken: string
  /** OAuth2 refresh token. */
  refreshToken: string
  /** Optional account ID associated with the profile. */
  accountId?: string
  /** Optional original auth.json object containing full authentication data. */
  authJson?: Record<string, unknown>
}

/** Constructs a ProfileSummary from authentication data and timestamps. */
export function buildProfileSummaryFromAuth(
  id: string,
  name: string,
  authData: AuthData,
  timestamp: string,
): ProfileSummary {
  return {
    id,
    name,
    email: authData.email,
    planType: authData.planType,
    accountId: authData.accountId,
    defaultOrganizationId: authData.defaultOrganizationId,
    defaultOrganizationTitle: authData.defaultOrganizationTitle,
    chatgptUserId: authData.chatgptUserId,
    userId: authData.userId,
    subject: authData.subject,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Extracts ProfileTokens from authentication data. */
export function buildProfileTokensFromAuth(authData: AuthData): ProfileTokens {
  return {
    idToken: authData.idToken,
    accessToken: authData.accessToken,
    refreshToken: authData.refreshToken,
    accountId: authData.accountId,
    authJson: authData.authJson,
  }
}
