/** Tests for codex-home-manager. */
import assert from 'node:assert/strict'
import * as path from 'node:path'
import test from 'node:test'
import { CodexHomeManager } from '../../src/codex-home/codex-home-manager'

const customHome = path.resolve('C:\\Temp\\codex-home')
const expectedName = path.basename(customHome)

test('CodexHomeManager resolves default and custom homes deterministically', () => {
  const defaultHome = new CodexHomeManager()
  assert.equal(defaultHome.isEnabled(), false)
  assert.equal(defaultHome.getActiveHome().isDefault, true)
  assert.equal(defaultHome.getActiveHome().usesPerHomeState, false)
  assert.equal(defaultHome.getActiveHome().id, 'default')
  assert.equal(defaultHome.buildLoginCommand(), 'codex login')

  const customHomeManager = new CodexHomeManager({
    initialCodexHome: 'C:\\Temp\\codex-home',
    codexHomeEnabled: true,
  })

  assert.equal(customHomeManager.isEnabled(), true)
  assert.equal(customHomeManager.getActiveHome().isDefault, false)
  assert.equal(customHomeManager.getActiveHome().usesPerHomeState, true)
  assert.equal(customHomeManager.getActiveHome().name, expectedName)
  assert.equal(customHomeManager.getActiveHome().fsPath, customHome)
  assert.ok(customHomeManager.getActiveHome().id.startsWith('env-'))
  assert.equal(customHomeManager.buildLoginCommand(), 'codex login')
})

test('CodexHomeManager uses WSL login command only for the default home', () => {
  const manager = new CodexHomeManager({
    codexHomeEnabled: true,
    useWslAuthPath: true,
    initialCodexHome: 'C:\\Temp\\codex-home',
  })

  assert.equal(manager.buildLoginCommand(), 'codex login')
  assert.equal(
    manager.isWslCustomHomeUnsupported(),
    process.platform === 'win32',
  )

  const defaultHome = new CodexHomeManager({
    useWslAuthPath: true,
  })

  assert.equal(defaultHome.buildLoginCommand(), 'wsl codex login')
})
