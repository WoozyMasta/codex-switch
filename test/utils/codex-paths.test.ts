import assert from 'node:assert/strict'
import * as path from 'path'
import test from 'node:test'
import {
  getCodexAuthPathForHome,
  resolveDefaultCodexHomePath,
} from '../../src/utils/codex-paths'

test('resolveDefaultCodexHomePath resolves env or default home deterministically', () => {
  const envHome = path.resolve('C:\\Temp\\codex-home')
  const homeDir = path.resolve('C:\\Users\\me')
  assert.equal(
    resolveDefaultCodexHomePath('C:\\Temp\\codex-home', 'C:\\Users\\me'),
    envHome,
  )
  assert.equal(
    resolveDefaultCodexHomePath(undefined, 'C:\\Users\\me'),
    path.resolve(path.join(homeDir, '.codex')),
  )
})

test('getCodexAuthPathForHome resolves the auth.json path from a home directory', () => {
  const home = path.resolve('C:\\tmp\\codex-home')
  assert.equal(
    getCodexAuthPathForHome('C:\\tmp\\codex-home'),
    path.join(home, 'auth.json'),
  )
})
