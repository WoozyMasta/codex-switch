/* c8 ignore file */
import fs from 'fs'
import path from 'path'
import { AuthData } from '../types'

interface CodexAuthSyncDeps {
  now?: () => number
}

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function requireNonEmptyString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Cannot build Codex auth payload: missing ${fieldName}`)
  }
  if (!value.trim()) {
    throw new Error(`Cannot build Codex auth payload: missing ${fieldName}`)
  }
  return value
}

export function buildCodexAuthJson(authData: AuthData): string {
  const authJson = authData.authJson
  if (isObjectRecord(authJson)) {
    const payload = JSON.parse(JSON.stringify(authJson))
    return `${JSON.stringify(payload, null, 2)}\n`
  }

  const idToken = requireNonEmptyString(authData.idToken, 'idToken')
  const accessToken = requireNonEmptyString(authData.accessToken, 'accessToken')
  const refreshToken = requireNonEmptyString(
    authData.refreshToken,
    'refreshToken',
  )

  const tokens: Record<string, string> = {
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken,
  }

  if (typeof authData.accountId === 'string') {
    if (authData.accountId.trim()) {
      tokens.account_id = authData.accountId
    }
  }

  return `${JSON.stringify({ tokens }, null, 2)}\n`
}

/**
 * Narrows the auth file to owner-only access, best effort.
 *
 * The copy fallback above creates the destination with the process umask when
 * it does not already exist, so the mode set on the temp file is not enough on
 * its own. Failures are ignored: chmod is meaningless on Windows, and a file
 * that was just written successfully should not be reported as a failed switch
 * because its mode could not be tightened.
 */
function restrictAuthFilePermissions(authPath: string) {
  if (process.platform === 'win32') {
    return
  }
  try {
    fs.chmodSync(authPath, 0o600)
  } catch {
    // ignore
  }
}

export function syncCodexAuthFile(
  authPath: string,
  authData: AuthData,
  deps: CodexAuthSyncDeps = {},
) {
  const dir = path.dirname(authPath)
  // 0o700: a Codex home holds OAuth refresh tokens, and a directory created
  // here for a custom CODEX_HOME would otherwise default to 0o755.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  let now = Date.now
  if (deps.now) {
    now = deps.now
  }

  const tmpPath = path.join(dir, `auth.json.tmp.${process.pid}.${now()}`)
  const content = buildCodexAuthJson(authData)

  // 0o600 on the TEMP file, because rename carries the source file's mode to
  // the destination: without it a switch relaxes an existing 0o600 auth.json
  // to 0o644 under the usual 0o022 umask, leaving refresh tokens readable by
  // every local account. Codex itself writes this file 0o600.
  fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 })

  // Best-effort atomic replace:
  // - POSIX: rename overwrites.
  // - Windows: rename over an existing file may fail, so fall back to copy+replace.
  try {
    try {
      fs.renameSync(tmpPath, authPath)
      restrictAuthFilePermissions(authPath)
      return
    } catch {
      // Fall back to non-atomic replace.
      fs.copyFileSync(tmpPath, authPath)
      restrictAuthFilePermissions(authPath)
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath)
      }
    } catch {
      // ignore
    }
  }
}
