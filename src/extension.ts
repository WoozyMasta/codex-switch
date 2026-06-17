import * as vscode from 'vscode'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import { createExtensionServices } from './extension-services'
import { startExtensionRuntime } from './extension-runtime'
import { debugLog, setDebugLoggingEnabledResolver } from './utils/log'

let profileRateLimitService: ProfileRateLimitService | undefined

setDebugLoggingEnabledResolver(() => {
  const codexSwitchConfig = vscode.workspace.getConfiguration('codexSwitch')
  if (codexSwitchConfig.has('debugLogging')) {
    return !!codexSwitchConfig.get<boolean>('debugLogging', false)
  }

  return !!vscode.workspace
    .getConfiguration('codexUsage')
    .get<boolean>('debugLogging', false)
})

export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const services = createExtensionServices(context)
  profileRateLimitService = services.profileRateLimitService
  startExtensionRuntime(context, services)
}

export async function deactivate() {
  await profileRateLimitService?.dispose()
}
