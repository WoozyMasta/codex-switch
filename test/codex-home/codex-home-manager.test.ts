import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexHomeManager } from '../../src/codex-home/codex-home-manager'

test('CodexHomeManager resolves default and custom homes deterministically', () => {
  const defaultHome = new CodexHomeManager()
  assert.equal(defaultHome.isEnabled(), false)
  assert.equal(defaultHome.getActiveHome().isDefault, true)
  assert.equal(defaultHome.getActiveHome().usesPerHomeState, false)
  assert.equal(defaultHome.getActiveHome().id, 'default')
  assert.equal(defaultHome.buildLoginCommand(), 'codex login')

  const customHome = new CodexHomeManager({
    initialCodexHome: 'C:\\Temp\\codex-home',
    codexHomeEnabled: true,
  })

  assert.equal(customHome.isEnabled(), true)
  assert.equal(customHome.getActiveHome().isDefault, false)
  assert.equal(customHome.getActiveHome().usesPerHomeState, true)
  assert.equal(customHome.getActiveHome().name, 'codex-home')
  assert.equal(customHome.getActiveHome().fsPath, 'C:\\Temp\\codex-home')
  assert.ok(customHome.getActiveHome().id.startsWith('env-'))
  assert.equal(customHome.buildLoginCommand(), 'codex login')
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
