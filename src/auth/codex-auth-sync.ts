import * as fs from 'fs'
import * as path from 'path'
import { AuthData } from '../types'

export function buildCodexAuthJson(authData: AuthData): string {
  // Preserve the full auth payload when available so other clients that rely on
  // additional metadata (for example token_data/auth status fields) keep working.
  const payload: any =
    authData.authJson && typeof authData.authJson === 'object'
      ? JSON.parse(JSON.stringify(authData.authJson))
      : {}

  if (!payload.tokens || typeof payload.tokens !== 'object') {
    payload.tokens = {}
  }

  payload.tokens.id_token = authData.idToken
  payload.tokens.access_token = authData.accessToken
  payload.tokens.refresh_token = authData.refreshToken

  if (authData.accountId) {
    payload.tokens.account_id = authData.accountId
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function syncCodexAuthFile(authPath: string, authData: AuthData) {
  const dir = path.dirname(authPath)
  fs.mkdirSync(dir, { recursive: true })

  const tmpPath = path.join(dir, `auth.json.tmp.${process.pid}.${Date.now()}`)
  const content = buildCodexAuthJson(authData)

  fs.writeFileSync(tmpPath, content, { encoding: 'utf8' })

  // Best-effort atomic replace:
  // - POSIX: rename overwrites.
  // - Windows: rename over an existing file may fail, so fall back to copy+replace.
  try {
    try {
      fs.renameSync(tmpPath, authPath)
      return
    } catch (e: any) {
      // Fall back to non-atomic replace.
      fs.copyFileSync(tmpPath, authPath)
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) { fs.unlinkSync(tmpPath) }
    } catch {
      // ignore
    }
  }
}
