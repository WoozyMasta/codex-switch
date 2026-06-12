import type { AuthData, ProfileSummary } from '../types'

export interface ProfileTokens {
  idToken: string
  accessToken: string
  refreshToken: string
  accountId?: string
  authJson?: Record<string, unknown>
}

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

export function buildProfileTokensFromAuth(authData: AuthData): ProfileTokens {
  return {
    idToken: authData.idToken,
    accessToken: authData.accessToken,
    refreshToken: authData.refreshToken,
    accountId: authData.accountId,
    authJson: authData.authJson,
  }
}
