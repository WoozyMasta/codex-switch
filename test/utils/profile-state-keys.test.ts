/** Tests for profile-state-keys. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfileStateKeys } from '../../src/utils/profile-state-keys'

test('buildProfileStateKeys returns active and last keys for a home id', () => {
  assert.deepEqual(buildProfileStateKeys('home-1'), {
    active: 'codexSwitch.activeProfileId.home-1',
    last: 'codexSwitch.lastProfileId.home-1',
  })
})
