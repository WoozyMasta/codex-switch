import type { AuthData } from '../types'
import { getCanonicalTokenBundle } from './auth-payload'

/** Parses a last refresh timestamp from various formats (number, date string, or numeric string). */
export function parseAuthLastRefresh(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value
    }
    return undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsedNumber = Number(trimmed)
  if (Number.isFinite(parsedNumber)) {
    return parsedNumber
  }

  const parsedDate = Date.parse(trimmed)
  if (Number.isFinite(parsedDate)) {
    return parsedDate
  }

  return undefined
}

/** Extracts the last refresh timestamp from AuthData's authJson field. */
export function getAuthLastRefresh(
  authData: AuthData | null,
): number | undefined {
  if (!authData?.authJson || typeof authData.authJson !== 'object') {
    return undefined
  }

  return parseAuthLastRefresh(
    (authData.authJson as Record<string, unknown>).last_refresh,
  )
}

/** Determines whether live authentication should replace stored auth based on refresh time and token changes. */
export function shouldReplaceStoredProfileAuthWithLive(
  storedAuth: AuthData | null,
  liveAuth: AuthData,
): boolean {
  const liveTokens = getCanonicalTokenBundle(liveAuth)
  if (!liveTokens) {
    return false
  }

  if (!storedAuth) {
    return true
  }

  const storedTokens = getCanonicalTokenBundle(storedAuth)
  if (!storedTokens) {
    return true
  }

  const storedRefresh = getAuthLastRefresh(storedAuth)
  const liveRefresh = getAuthLastRefresh(liveAuth)

  if (
    storedRefresh !== undefined &&
    liveRefresh !== undefined &&
    liveRefresh < storedRefresh
  ) {
    return false
  }

  if (storedRefresh !== undefined && liveRefresh === undefined) {
    return false
  }

  if (
    storedTokens.idToken !== liveTokens.idToken ||
    storedTokens.accessToken !== liveTokens.accessToken ||
    storedTokens.refreshToken !== liveTokens.refreshToken
  ) {
    return true
  }

  if (storedRefresh === undefined && liveRefresh !== undefined) {
    return true
  }

  return false
}
