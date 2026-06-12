import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStorageMode } from '../../src/utils/storage-mode'

test('resolveStorageMode resolves auto mode from remoteName and preserves explicit values', () => {
  assert.equal(resolveStorageMode('auto', undefined), 'secretStorage')
  assert.equal(resolveStorageMode('auto', 'ssh-remote'), 'remoteFiles')
  assert.equal(
    resolveStorageMode('secretStorage', 'ssh-remote'),
    'secretStorage',
  )
  assert.equal(resolveStorageMode('remoteFiles', undefined), 'remoteFiles')
})
