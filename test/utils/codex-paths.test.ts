/** Tests for codex-paths. */
import assert from 'node:assert/strict'
import * as path from 'node:path'
import test from 'node:test'
import {
  getCodexAuthPathForHome,
  resolveDefaultCodexHomePath,
} from '../../src/utils/codex-paths'

const envHome = path.resolve('C:\\Temp\\codex-home')
const userHome = path.resolve('C:\\Users\\me')
const expectedDefaultHome = path.resolve(path.join(userHome, '.codex'))
const expectedAuthPath = path.join(
  path.resolve('C:\\tmp\\codex-home'),
  'auth.json',
)

test('resolveDefaultCodexHomePath resolves env or default home deterministically', () => {
  assert.equal(
    resolveDefaultCodexHomePath('C:\\Temp\\codex-home', 'C:\\Users\\me'),
    envHome,
  )
  assert.equal(
    resolveDefaultCodexHomePath(undefined, 'C:\\Users\\me'),
    expectedDefaultHome,
  )
})

test('getCodexAuthPathForHome resolves the auth.json path from a home directory', () => {
  assert.equal(getCodexAuthPathForHome('C:\\tmp\\codex-home'), expectedAuthPath)
})
