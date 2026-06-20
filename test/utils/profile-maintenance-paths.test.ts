/** Tests for profile-maintenance-paths. */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildMaintenancePaths,
  computeProductScopeHash,
  hashProfileId,
  type ProductScopeInput,
} from '../../src/utils/profile-maintenance-paths'

const baseInput: ProductScopeInput = {
  appName: 'Visual Studio Code',
  uriScheme: 'vscode',
  remoteName: undefined,
  globalStorageFsPath: '/home/user/.config/Code/User/globalStorage/ext',
  profileStorageBackend: 'secretStorage',
}

test('computeProductScopeHash is deterministic for identical inputs', () => {
  assert.equal(
    computeProductScopeHash(baseInput),
    computeProductScopeHash({ ...baseInput }),
  )
})

test('computeProductScopeHash treats missing remoteName as local', () => {
  assert.equal(
    computeProductScopeHash({ ...baseInput, remoteName: undefined }),
    computeProductScopeHash({ ...baseInput, remoteName: 'local' }),
  )
})

test('computeProductScopeHash separates different products and backends', () => {
  const scope = computeProductScopeHash(baseInput)
  assert.notEqual(
    scope,
    computeProductScopeHash({ ...baseInput, appName: 'Cursor' }),
  )
  assert.notEqual(
    scope,
    computeProductScopeHash({ ...baseInput, uriScheme: 'cursor' }),
  )
  assert.notEqual(
    scope,
    computeProductScopeHash({ ...baseInput, remoteName: 'ssh-remote' }),
  )
  assert.notEqual(
    scope,
    computeProductScopeHash({
      ...baseInput,
      globalStorageFsPath: '/other/path',
    }),
  )
  assert.notEqual(
    scope,
    computeProductScopeHash({
      ...baseInput,
      profileStorageBackend: 'remoteFiles',
    }),
  )
})

test('hashProfileId is opaque and deterministic', () => {
  const hash = hashProfileId('profile-123')
  assert.equal(hash, hashProfileId('profile-123'))
  assert.notEqual(hash, hashProfileId('profile-456'))
  assert.doesNotMatch(hash, /profile-123/)
  assert.match(hash, /^[0-9a-f]{64}$/)
})

test('buildMaintenancePaths composes versioned, opaque paths', () => {
  const scope = computeProductScopeHash(baseInput)
  const paths = buildMaintenancePaths(scope, '/tmp/home')

  assert.equal(
    paths.root,
    path.join('/tmp/home', '.codex-switch', 'maintenance', 'v1', scope),
  )
  assert.equal(paths.leaseFile, path.join(paths.root, 'maintenance.lease'))
  assert.equal(paths.profilesDir, path.join(paths.root, 'profiles'))

  const stateFile = paths.profileStateFile('profile-123')
  assert.equal(
    stateFile,
    path.join(paths.profilesDir, `${hashProfileId('profile-123')}.json`),
  )
  assert.doesNotMatch(stateFile, /profile-123/)
})

test('buildMaintenancePaths defaults to the user home directory', () => {
  const scope = computeProductScopeHash(baseInput)
  const paths = buildMaintenancePaths(scope)
  assert.equal(
    paths.root,
    path.join(os.homedir(), '.codex-switch', 'maintenance', 'v1', scope),
  )
})
