import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSharedActiveProfile } from '../../src/utils/shared-active-profile'

test('resolveSharedActiveProfile prefers per-home state and only lets default home inherit legacy state', () => {
  assert.deepEqual(
    resolveSharedActiveProfile(
      { profileId: 'per-home' },
      { profileId: 'legacy' },
      true,
    ),
    { profileId: 'per-home' },
  )

  assert.deepEqual(
    resolveSharedActiveProfile(null, { profileId: 'legacy' }, true),
    { profileId: 'legacy' },
  )

  assert.equal(
    resolveSharedActiveProfile(null, { profileId: 'legacy' }, false),
    null,
  )
  assert.equal(resolveSharedActiveProfile(null, null, true), null)
})
