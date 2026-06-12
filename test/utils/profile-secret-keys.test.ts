import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfileSecretKeys } from '../../src/utils/profile-secret-keys'

test('buildProfileSecretKeys returns current and legacy secret keys', () => {
  assert.deepEqual(buildProfileSecretKeys('abc-123'), {
    current: 'codexSwitch.profile.abc-123',
    legacy: 'codexUsage.profile.abc-123',
  })
})
