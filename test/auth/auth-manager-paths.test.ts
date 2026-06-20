/** Tests for auth-manager-paths. */
import assert from 'node:assert/strict'
import * as path from 'node:path'
import test from 'node:test'
import { getDefaultCodexAuthPathForHome } from '../../src/auth/auth-manager'
import {
  getCodexAuthPathForHome,
  resolveDefaultCodexHomePath,
} from '../../src/utils/codex-paths'

const customHome = path.resolve('C:\\Temp\\codex-home')
const meHome = path.resolve('C:\\Users\\me')
const expectedCustomHome = path.resolve(customHome)
const expectedDefaultHome = path.resolve(path.join(meHome, '.codex'))
const expectedAuthPath = path.join(expectedCustomHome, 'auth.json')

test('resolveDefaultCodexHomePath and getCodexAuthPathForHome resolve deterministic paths', () => {
  assert.equal(
    resolveDefaultCodexHomePath('C:\\Temp\\codex-home', 'C:\\Users\\me'),
    expectedCustomHome,
  )
  assert.equal(
    resolveDefaultCodexHomePath(undefined, 'C:\\Users\\me'),
    expectedDefaultHome,
  )
  assert.equal(
    getCodexAuthPathForHome('C:\\Temp\\codex-home'),
    expectedAuthPath,
  )
})

test('getDefaultCodexAuthPathForHome uses WSL auth path only when enabled on Windows', () => {
  const localPath = expectedAuthPath
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
