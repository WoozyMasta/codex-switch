import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { execFileSync } from 'child_process'
import { AuthData } from '../types'
import { errorLog } from '../utils/log'

const WSL_AUTH_PATH_CACHE_TTL_MS = 60 * 1000
const WSL_AUTH_PATH_ERROR_LOG_COOLDOWN_MS = 60 * 1000

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
export function getDefaultCodexHomePath(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

/**
 * Resolve default Codex auth file path.
 */
export function getDefaultCodexAuthPath(): string {
  const localPath = path.join(getDefaultCodexHomePath(), 'auth.json')
  if (!shouldUseWslAuthPath()) {
    return localPath
  }

  const wslPath = getCachedWslDefaultCodexAuthPath()
  return wslPath || localPath
}

export function shouldUseWslAuthPath(): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  return !!vscode.workspace
    .getConfiguration('chatgpt')
    .get<boolean>('runCodexInWindowsSubsystemForLinux', false)
}

function getCachedWslDefaultCodexAuthPath(): string | null {
  const now = Date.now()
  if (
    cachedWslAuthPath !== undefined &&
    now - cachedWslAuthPathAt < WSL_AUTH_PATH_CACHE_TTL_MS
  ) {
    return cachedWslAuthPath
  }

  const resolved = resolveWslDefaultCodexAuthPath()
  cachedWslAuthPath = resolved
  cachedWslAuthPathAt = now
  return resolved
}

function resolveWslDefaultCodexAuthPath(): string | null {
  try {
    // Convert WSL ~/.codex/auth.json to a Windows path (for example \\wsl$\<distro>\...).
    const out = execFileSync(
      'wsl.exe',
      ['sh', '-lc', 'wslpath -w ~/.codex/auth.json'],
      { encoding: 'utf8', windowsHide: true },
    )
    const p = String(out || '').trim()
    return p || null
  } catch (error) {
    const now = Date.now()
    if (
      now - lastWslAuthResolveErrorAt >=
      WSL_AUTH_PATH_ERROR_LOG_COOLDOWN_MS
    ) {
      lastWslAuthResolveErrorAt = now
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
