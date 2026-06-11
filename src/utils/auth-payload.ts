import { AuthData } from '../types'

export interface CanonicalTokenBundle {
  idToken: string
  accessToken: string
  refreshToken: string
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getCanonicalTokenBundle(
  authData: AuthData,
): CanonicalTokenBundle | undefined {
  const authJson = asObject(authData.authJson)
  if (!authJson) {
    return undefined
  }

  const tokens = asObject(authJson.tokens)
  if (!tokens) {
    return undefined
  }

  const idToken = asNonEmptyString(tokens.id_token)
  const accessToken = asNonEmptyString(tokens.access_token)
  const refreshToken = asNonEmptyString(tokens.refresh_token)

  if (!idToken || !accessToken || !refreshToken) {
    return undefined
  }

  return {
    idToken,
    accessToken,
    refreshToken,
  }
}

export function validateImportedAuthJson(
  authJson: unknown,
  tokens: CanonicalTokenBundle & { accountId?: string },
): Record<string, unknown> | null {
  const root = asObject(authJson)
  if (!root) {
    return null
  }

  const nestedTokens = asObject(root.tokens)
  if (!nestedTokens) {
    return null
  }

  const nestedIdToken = asNonEmptyString(nestedTokens.id_token)
  const nestedAccessToken = asNonEmptyString(nestedTokens.access_token)
  const nestedRefreshToken = asNonEmptyString(nestedTokens.refresh_token)
  if (
    nestedIdToken !== tokens.idToken ||
    nestedAccessToken !== tokens.accessToken ||
    nestedRefreshToken !== tokens.refreshToken
  ) {
    return null
  }

  const nestedAccountId = asNonEmptyString(nestedTokens.account_id)
  if (
    tokens.accountId &&
    nestedAccountId &&
    nestedAccountId !== tokens.accountId
  ) {
    return null
  }

  return root
}
