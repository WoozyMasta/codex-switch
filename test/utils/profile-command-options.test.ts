/** Tests for profile-command-options. */
import assert from 'node:assert/strict'
import * as path from 'path'
import test from 'node:test'
import {
  resolveDefaultSettingsExportPath,
  resolveStatusBarClickBehavior,
} from '../../src/utils/profile-command-options'

test('resolveStatusBarClickBehavior normalizes invalid values to cycle', () => {
  assert.equal(resolveStatusBarClickBehavior('toggleLast'), 'toggleLast')
  assert.equal(resolveStatusBarClickBehavior('selector'), 'selector')
  assert.equal(resolveStatusBarClickBehavior('unexpected'), 'cycle')
  assert.equal(resolveStatusBarClickBehavior(undefined), 'cycle')
  assert.equal(resolveStatusBarClickBehavior(null), 'cycle')
})

test('resolveDefaultSettingsExportPath prefers workspace and falls back to home', () => {
  assert.equal(
    resolveDefaultSettingsExportPath('C:\\work', 'C:\\Users\\me'),
    path.join('C:\\work', 'codex-switch-profiles.json'),
  )
  assert.equal(
    resolveDefaultSettingsExportPath(undefined, '/home/me'),
    path.join('/home/me', 'codex-switch-profiles.json'),
  )
  assert.equal(
    resolveDefaultSettingsExportPath('', '/home/me'),
    path.join('/home/me', 'codex-switch-profiles.json'),
  )
})
