import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultCodexAuthPathForHome } from '../../src/auth/auth-manager'
import {
  getCodexAuthPathForHome,
  resolveDefaultCodexHomePath,
} from '../../src/utils/codex-paths'

test('resolveDefaultCodexHomePath and getCodexAuthPathForHome resolve deterministic paths', () => {
  assert.equal(
    resolveDefaultCodexHomePath('C:\\Temp\\codex-home', 'C:\\Users\\me'),
    'C:\\Temp\\codex-home',
  )
  assert.equal(
    resolveDefaultCodexHomePath(undefined, 'C:\\Users\\me'),
    'C:\\Users\\me\\.codex',
  )
  assert.equal(
    getCodexAuthPathForHome('C:\\Temp\\codex-home'),
    'C:\\Temp\\codex-home\\auth.json',
  )
})

test('getDefaultCodexAuthPathForHome uses WSL auth path only when enabled on Windows', () => {
  const localPath = getCodexAuthPathForHome('C:\\Temp\\codex-home')
  const wslPath = 'C:\\Users\\me\\AppData\\Local\\Temp\\wsl-auth.json'
  const deps = {
    now: () => 123,
    execFileSync: () => wslPath,
  } as any

  assert.equal(
    getDefaultCodexAuthPathForHome('C:\\Temp\\codex-home', {
      useWslAuthPath: false,
      ...deps,
    }),
    localPath,
  )

  const resolved = getDefaultCodexAuthPathForHome('C:\\Temp\\codex-home', {
    useWslAuthPath: true,
    ...deps,
  })
  assert.equal(resolved, process.platform === 'win32' ? wslPath : localPath)

  assert.equal(
    getDefaultCodexAuthPathForHome('C:\\Temp\\codex-home', {
      useWslAuthPath: true,
      now: () => 60_124,
      execFileSync: (() => '   ') as any,
    }),
    localPath,
  )
})
