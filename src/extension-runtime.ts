import * as vscode from 'vscode'
import type { ExtensionServices } from './extension-services'
import { createExtensionUiController } from './extension-ui-controller'
import { createStatusBarItem } from './ui/status-bar'
import { registerCommands } from './commands'

export function startExtensionRuntime(
  context: vscode.ExtensionContext,
  services: ExtensionServices,
): void {
  const { profileManager, codexHomeManager, profileRateLimitService, runtime } =
    services

  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  if (codexHomeManager.isWslCustomHomeUnsupported()) {
    vscode.window.showErrorMessage(
      'Codex Switch does not support a custom CODEX_HOME when Chat runs Codex in WSL. Disable codexHome.enabled or turn off runCodexInWindowsSubsystemForLinux.',
    )
    return
  }

  const uiController = createExtensionUiController(context, services)

  registerCommands(
    context,
    profileManager,
    codexHomeManager,
    runtime.home,
    profileRateLimitService,
    uiController.refreshUi,
  )

  context.subscriptions.push(
    ...profileManager.createWatchers(() => {
      void uiController.refreshUi()
    }, runtime.home.authPath),
  )

  void uiController.reconcileAndRefresh()
}
