import assert from 'node:assert/strict'
import test from 'node:test'
import * as vscode from 'vscode'
import { restartExtensionHostOrReloadWindow } from '../../src/utils/vscode-restart'

const commands = vscode.commands as unknown as {
  getCommands: (includeInternal?: boolean) => Promise<string[]>
  executeCommand: (commandId: string) => Promise<void>
}

test('restarts the extension host when the command is available', async () => {
  const originalGetCommands = commands.getCommands
  const originalExecuteCommand = commands.executeCommand
  const executed: string[] = []

  try {
    commands.getCommands = async () => ['workbench.action.restartExtensionHost']
    commands.executeCommand = async (commandId: string) => {
      executed.push(commandId)
    }

    await restartExtensionHostOrReloadWindow()

    assert.deepEqual(executed, ['workbench.action.restartExtensionHost'])
  } finally {
    commands.getCommands = originalGetCommands
    commands.executeCommand = originalExecuteCommand
  }
})

test('falls back to reloading the window when restart is unavailable', async () => {
  const originalGetCommands = commands.getCommands
  const originalExecuteCommand = commands.executeCommand
  const executed: string[] = []

  try {
    commands.getCommands = async () => []
    commands.executeCommand = async (commandId: string) => {
      executed.push(commandId)
    }

    await restartExtensionHostOrReloadWindow()

    assert.deepEqual(executed, ['workbench.action.reloadWindow'])
  } finally {
    commands.getCommands = originalGetCommands
    commands.executeCommand = originalExecuteCommand
  }
})

test('falls back to reloading the window when restart command execution fails', async () => {
  const originalGetCommands = commands.getCommands
  const originalExecuteCommand = commands.executeCommand
  const executed: string[] = []

  try {
    commands.getCommands = async () => ['workbench.action.restartExtensionHost']
    commands.executeCommand = async (commandId: string) => {
      executed.push(commandId)
      if (commandId === 'workbench.action.restartExtensionHost') {
        throw new Error('restart failed')
      }
    }

    await restartExtensionHostOrReloadWindow()

    assert.deepEqual(executed, [
      'workbench.action.restartExtensionHost',
      'workbench.action.reloadWindow',
    ])
  } finally {
    commands.getCommands = originalGetCommands
    commands.executeCommand = originalExecuteCommand
  }
})
