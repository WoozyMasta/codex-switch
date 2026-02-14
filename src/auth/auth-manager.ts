import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AuthData } from '../types'
import { errorLog } from '../utils/log'

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
  return path.join(codexHome, 'auth.json')
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

    return {
      idToken: authJson.tokens.id_token,
      accessToken: authJson.tokens.access_token,
      refreshToken: authJson.tokens.refresh_token,
      accountId: authJson.tokens.account_id,
      email: idTokenPayload.email || 'Unknown',
      planType:
        idTokenPayload['https://api.openai.com/auth']?.chatgpt_plan_type ||
        'Unknown',
      authJson,
    }
  } catch (error) {
    errorLog('Error reading auth file:', error)
    return null
  }
}
