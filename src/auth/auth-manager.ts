import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { execFileSync } from 'child_process'
import { AuthData } from '../types'
import { errorLog } from '../utils/log'

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return v ? v : undefined
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

/**
 * Resolve default Codex auth file path.
 */
export function getDefaultCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const localPath = path.join(codexHome, 'auth.json')
  if (!shouldUseWslAuthPath()) return localPath

  const wslPath = resolveWslDefaultCodexAuthPath()
  return wslPath || localPath
}

export function shouldUseWslAuthPath(): boolean {
  if (process.platform !== 'win32') return false
  return !!vscode.workspace
    .getConfiguration('chatgpt')
    .get<boolean>('runCodexInWindowsSubsystemForLinux', false)
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
    errorLog('Error resolving WSL auth file path:', error)
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
    const authJson = JSON.parse(authContent)

    if (!authJson.tokens) {
      return null
    }

    // Parse ID token to get user info
    const idTokenPayload = parseJWT(authJson.tokens.id_token)
    const authPayload = idTokenPayload['https://api.openai.com/auth']

    return {
      idToken: authJson.tokens.id_token,
      accessToken: authJson.tokens.access_token,
      refreshToken: authJson.tokens.refresh_token,
      accountId: authJson.tokens.account_id,
      chatgptUserId: asNonEmptyString(authPayload?.chatgpt_user_id),
      userId: asNonEmptyString(authPayload?.user_id),
      subject: asNonEmptyString(idTokenPayload.sub),
      email: idTokenPayload.email || 'Unknown',
      planType: authPayload?.chatgpt_plan_type || 'Unknown',
      authJson,
    }
  } catch (error) {
    errorLog('Error reading auth file:', error)
    return null
  }
}
