import * as fs from 'fs'
import { execFileSync } from 'child_process'
import { AuthData } from '../types'
import { errorLog } from '../utils/log'
import {
  getCodexAuthPathForHome,
  resolveDefaultCodexHomePath,
} from '../utils/codex-paths'
import type { Clock, ProcessEnv } from './runtime-adapters'

const WSL_AUTH_PATH_CACHE_TTL_MS = 60 * 1000
const WSL_AUTH_PATH_ERROR_LOG_COOLDOWN_MS = 60 * 1000

interface AuthManagerClockDeps {
  now?: Clock
  useWslAuthPath?: boolean
  env?: ProcessEnv
  execFileSync?: typeof execFileSync
}

let cachedWslAuthPath: string | null | undefined
let cachedWslAuthPathAt = 0
let lastWslAuthResolveErrorAt = 0

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return value as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const v = value.trim()
  return v ? v : undefined
}

function getDefaultOrganization(authPayload: any): {
  id?: string
  title?: string
} {
  const directId =
    asNonEmptyString(authPayload?.selected_organization_id) ||
    asNonEmptyString(authPayload?.default_organization_id)

  const organizations = Array.isArray(authPayload?.organizations)
    ? authPayload.organizations
    : []

  if (directId) {
    const match = organizations.find(
      (org: any) => asNonEmptyString(org?.id) === directId,
    )
    return {
      id: directId,
      title: asNonEmptyString(match?.title),
    }
  }

  if (organizations.length === 0) {
    return {}
  }

  const selected =
    organizations.find((org: any) => org?.is_default) || organizations[0]
  return {
    id: asNonEmptyString(selected?.id),
    title: asNonEmptyString(selected?.title),
  }
}

/**
 * Parse JWT token to extract payload
 */
function parseJWT(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid JWT')
    }
    const payload = Buffer.from(parts[1], 'base64url').toString()
    return JSON.parse(payload)
  } catch (error) {
    errorLog('Error parsing JWT:', error)
    return {}
  }
}

export function extractAuthDataFromAuthJson(
  authJson: unknown,
): Partial<AuthData> | null {
  const root = asObjectRecord(authJson)
  if (!root) {
    return null
  }

  const tokens = asObjectRecord(root.tokens)
  if (!tokens) {
    return null
  }

  const idToken = asNonEmptyString(tokens.id_token)
  const accessToken = asNonEmptyString(tokens.access_token)
  const refreshToken = asNonEmptyString(tokens.refresh_token)
  const accountId = asNonEmptyString(tokens.account_id)

  const idTokenPayload = idToken ? parseJWT(idToken) : {}
  const authPayload = asObjectRecord(
    idTokenPayload['https://api.openai.com/auth'],
  )
  const defaultOrganization = getDefaultOrganization(authPayload)

  return {
    idToken,
    accessToken,
    refreshToken,
    accountId,
    defaultOrganizationId: defaultOrganization.id,
    defaultOrganizationTitle: defaultOrganization.title,
    chatgptUserId: asNonEmptyString(authPayload?.chatgpt_user_id),
    userId: asNonEmptyString(authPayload?.user_id),
    subject: asNonEmptyString(idTokenPayload.sub),
    email: asNonEmptyString(idTokenPayload.email),
    planType: asNonEmptyString(authPayload?.chatgpt_plan_type),
    authJson: root,
  }
}

/**
 * Resolve default Codex home path.
 */
export function getDefaultCodexHomePath(
  deps: AuthManagerClockDeps = {},
): string {
  return resolveDefaultCodexHomePath(deps.env?.CODEX_HOME)
}

export function getDefaultCodexAuthPathForHome(
  codexHomePath: string,
  deps: AuthManagerClockDeps = {},
): string {
  const localPath = getCodexAuthPathForHome(codexHomePath)
  if (!shouldUseWslAuthPath(deps.useWslAuthPath)) {
    return localPath
  }

  const wslPath = getCachedWslDefaultCodexAuthPath(deps.now, deps.execFileSync)
  return wslPath || localPath
}

/**
 * Resolve default Codex auth file path.
 */
export function getDefaultCodexAuthPath(): string {
  return getDefaultCodexAuthPathForHome(getDefaultCodexHomePath())
}

export function shouldUseWslAuthPath(enabled?: boolean): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  if (enabled !== undefined) {
    return enabled
  }
  return false
}

function getCachedWslDefaultCodexAuthPath(
  now: Clock = Date.now,
  execFileSyncFn: typeof execFileSync = execFileSync,
): string | null {
  const current = now()
  if (
    cachedWslAuthPath !== undefined &&
    current - cachedWslAuthPathAt < WSL_AUTH_PATH_CACHE_TTL_MS
  ) {
    return cachedWslAuthPath
  }

  const resolved = resolveWslDefaultCodexAuthPath(now, execFileSyncFn)
  cachedWslAuthPath = resolved
  cachedWslAuthPathAt = current
  return resolved
}

function resolveWslDefaultCodexAuthPath(
  now: Clock = Date.now,
  execFileSyncFn: typeof execFileSync = execFileSync,
): string | null {
  try {
    // Convert WSL ~/.codex/auth.json to a Windows path (for example \\wsl$\<distro>\...).
    const out = execFileSyncFn(
      'wsl.exe',
      ['sh', '-lc', 'wslpath -w ~/.codex/auth.json'],
      { encoding: 'utf8', windowsHide: true },
    )
    const p = String(out || '').trim()
    return p || null
  } catch (error) {
    const current = now()
    if (
      current - lastWslAuthResolveErrorAt >=
      WSL_AUTH_PATH_ERROR_LOG_COOLDOWN_MS
    ) {
      lastWslAuthResolveErrorAt = current
      errorLog('Error resolving WSL auth file path:', error)
    }
    return null
  }
}

export async function loadAuthDataFromFile(
  authPath: string,
): Promise<AuthData | null> {
  try {
    if (!fs.existsSync(authPath)) {
      return null
    }

    const authContent = fs.readFileSync(authPath, 'utf8')
    const authJson = JSON.parse(authContent) as unknown
    const extracted = extractAuthDataFromAuthJson(authJson)
    if (!extracted) {
      return null
    }
    if (
      !extracted.idToken ||
      !extracted.accessToken ||
      !extracted.refreshToken
    ) {
      return null
    }

    return {
      idToken: extracted.idToken,
      accessToken: extracted.accessToken,
      refreshToken: extracted.refreshToken,
      accountId: extracted.accountId,
      defaultOrganizationId: extracted.defaultOrganizationId,
      defaultOrganizationTitle: extracted.defaultOrganizationTitle,
      chatgptUserId: extracted.chatgptUserId,
      userId: extracted.userId,
      subject: extracted.subject,
      email: extracted.email || 'Unknown',
      planType: extracted.planType || 'Unknown',
      authJson: extracted.authJson,
    }
  } catch (error) {
    errorLog('Error reading auth file:', error)
    return null
  }
}
