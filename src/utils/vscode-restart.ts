import * as vscode from 'vscode'

const RESTART_EXTENSION_HOST_COMMAND_ID =
  'workbench.action.restartExtensionHost'
const RELOAD_WINDOW_COMMAND_ID = 'workbench.action.reloadWindow'

export async function restartExtensionHostOrReloadWindow(): Promise<void> {
  const commandIds = await vscode.commands.getCommands(true)
  if (commandIds.includes(RESTART_EXTENSION_HOST_COMMAND_ID)) {
    try {
      await vscode.commands.executeCommand(RESTART_EXTENSION_HOST_COMMAND_ID)
      return
    } catch {
      // Fall back to full window reload on older or restricted hosts.
    }
  }

  await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND_ID)
}
