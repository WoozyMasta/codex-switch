import * as vscode from 'vscode'
import { ProfileRateLimitService } from './auth/profile-rate-limit-service'
import { ProfileMaintenanceService } from './auth/profile-maintenance-service'
import { createExtensionServices } from './extension-services'
import { startExtensionRuntime } from './extension-runtime'
import { debugLog, setDebugLoggingEnabledResolver } from './utils/log'

let profileRateLimitService: ProfileRateLimitService | undefined
let profileMaintenanceService: ProfileMaintenanceService | undefined

setDebugLoggingEnabledResolver(() => {
  const codexSwitchConfig = vscode.workspace.getConfiguration('codexSwitch')
  if (codexSwitchConfig.has('debugLogging')) {
    return !!codexSwitchConfig.get<boolean>('debugLogging', false)
  }

  return !!vscode.workspace
    .getConfiguration('codexUsage')
    .get<boolean>('debugLogging', false)
})

/**
 * Initializes the Codex Switch VS Code extension, setting up all services and the extension runtime.
 * Called by VS Code when the extension is activated.
 * @param context - The extension context from VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
  debugLog('Codex Switch activated')

  const services = createExtensionServices(context)
  profileRateLimitService = services.profileRateLimitService
  profileMaintenanceService = services.profileMaintenanceService
  startExtensionRuntime(context, services)
}

/**
 * Cleans up extension resources when the extension is deactivating.
 * Disposes background services and finalizes state.
 * Called by VS Code when the extension is deactivated.
 * @returns A promise that resolves when cleanup completes.
 */
export async function deactivate() {
  await profileMaintenanceService?.dispose()
  await profileRateLimitService?.dispose()
}
