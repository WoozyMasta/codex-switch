import { AuthData } from '../types'

/** The minimal set of required tokens extracted from an auth.json. */
export interface CanonicalTokenBundle {
  /** OpenID Connect identity token. */
  idToken: string
  /** OAuth2 access token. */
  accessToken: string
  /** OAuth2 refresh token. */
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

/** Extracts the canonical token bundle from AuthData, or undefined if any required token is missing. */
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

/** Validates that an imported auth.json matches expected tokens, returning the root object or null if invalid. */
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
