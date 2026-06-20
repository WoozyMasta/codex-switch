/* global suite, suiteSetup, test */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as vscode from 'vscode'
import { createExtensionServices } from '../../extension-services'

class MemoryMemento {
  private readonly values = new Map<string, unknown>()

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key)
      return
    }
    this.values.set(key, value)
  }

  keys(): readonly string[] {
    return [...this.values.keys()]
  }
}

class MemorySecretStorage {
  private readonly values = new Map<string, string>()

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key))
  }

  store(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  keys(): readonly string[] {
    return [...this.values.keys()]
  }

  onDidChange = (() => ({
    dispose: () => undefined,
  })) as vscode.Event<vscode.SecretStorageChangeEvent>
}

function makeAuthData(id: string) {
  return {
    idToken: `${id}-id`,
    accessToken: `${id}-access`,
    refreshToken: `${id}-refresh`,
    accountId: `${id}-account`,
    defaultOrganizationId: `${id}-org`,
    defaultOrganizationTitle: `${id} Org`,
    chatgptUserId: `${id}-chatgpt`,
    userId: `${id}-user`,
    subject: `${id}-subject`,
    email: `${id}@example.com`,
    planType: 'plus',
    authJson: {
      tokens: {
        id_token: `${id}-id`,
        access_token: `${id}-access`,
        refresh_token: `${id}-refresh`,
        account_id: `${id}-account`,
      },
    },
  }
}

let extension: vscode.Extension<unknown>

suite('Codex Switch extension smoke', () => {
  suiteSetup(async () => {
    const discovered = vscode.extensions.getExtension(
      'woozy-masta.codex-switch',
    )
    assert.ok(discovered, 'extension should be discoverable')
    extension = discovered
    await extension.activate()
  })

  test('registers commands and writes auth.json after a profile switch', async () => {
    const commands = await vscode.commands.getCommands(true)
    for (const commandId of [
      'codex-switch.login',
      'codex-switch.profile.switch',
      'codex-switch.profile.manage',
    ]) {
      assert.ok(commands.includes(commandId), `missing command ${commandId}`)
    }

    const originalCodeXHome = process.env.CODEX_HOME
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codex-switch-smoke-'))
    const codeXHome = path.join(tempRoot, 'home')
    const globalStoragePath = path.join(tempRoot, 'global-storage')

    try {
      process.env.CODEX_HOME = codeXHome

      const services = createExtensionServices({
        globalState: new MemoryMemento(),
        workspaceState: new MemoryMemento(),
        secrets: new MemorySecretStorage() as never,
        globalStorageUri: vscode.Uri.file(globalStoragePath),
        extension: {
          packageJSON: {
            version: String(extension.packageJSON.version),
          },
        },
      } as unknown as vscode.ExtensionContext)

      const profile = await services.profileManager.createProfile(
        'Smoke',
        makeAuthData('smoke'),
      )
      assert.equal(
        await services.profileManager.setActiveProfileId(profile.id),
        true,
      )
      assert.equal(
        await services.profileManager.getActiveProfileId(),
        profile.id,
      )

      const authPath = path.join(codeXHome, 'auth.json')
      assert.equal(
        readFileSync(authPath, 'utf8').includes('smoke-access'),
        true,
        'expected auth.json to be written for the active profile',
      )
    } finally {
      process.env.CODEX_HOME = originalCodeXHome
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('restarts or reloads when storage settings change', async () => {
    const commandModule = vscode.commands as unknown as {
      executeCommand: (commandId: string) => Promise<unknown>
    }
    const originalExecuteCommand = commandModule.executeCommand
    const executedCommands: string[] = []
    const configuration = vscode.workspace.getConfiguration('codexSwitch')
    const originalStorageMode = configuration.get<string>('storageMode')
    const nextStorageMode =
      originalStorageMode === 'remoteFiles' ? 'auto' : 'remoteFiles'

    try {
      commandModule.executeCommand = async (commandId: string) => {
        executedCommands.push(commandId)
        return undefined
      }

      await configuration.update(
        'storageMode',
        nextStorageMode,
        vscode.ConfigurationTarget.Global,
      )

      await waitFor(
        () =>
          executedCommands.includes('workbench.action.restartExtensionHost') ||
          executedCommands.includes('workbench.action.reloadWindow'),
      )

      assert.equal(executedCommands.length > 0, true)
    } finally {
      commandModule.executeCommand = originalExecuteCommand
      await configuration.update(
        'storageMode',
        originalStorageMode,
        vscode.ConfigurationTarget.Global,
      )
    }
  })
})

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  assert.fail(`timed out after ${timeoutMs}ms`)
}
