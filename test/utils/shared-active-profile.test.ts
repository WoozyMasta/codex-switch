import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveDefaultHomeActiveProfileId,
  resolveSharedActiveProfile,
} from '../../src/utils/shared-active-profile'

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

  assert.deepEqual(
    resolveSharedActiveProfile(
      { profileId: 'per-home' },
      { profileId: 'legacy' },
      false,
    ),
    { profileId: 'per-home' },
  )

  assert.equal(
    resolveSharedActiveProfile(null, { profileId: 'legacy' }, false),
    null,
  )
  assert.equal(resolveSharedActiveProfile(null, null, true), null)
})

test('resolveDefaultHomeActiveProfileId prefers remote default-home state and falls back locally', () => {
  assert.equal(
    resolveDefaultHomeActiveProfileId(
      'remote-default',
      'remote-legacy',
      'local-default',
      'local-active',
      'local-old',
      'local-legacy-old',
      true,
    ),
    'remote-default',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      null,
      'remote-legacy',
      'local-default',
      'local-active',
      'local-old',
      'local-legacy-old',
      true,
    ),
    'remote-legacy',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      null,
      null,
      'local-default',
      'local-active',
      'local-old',
      'local-legacy-old',
      false,
    ),
    'local-default',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      undefined,
      undefined,
      undefined,
      'local-active',
      'local-old',
      'local-legacy-old',
      false,
    ),
    'local-active',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      undefined,
      undefined,
      undefined,
      undefined,
      'local-old',
      'local-legacy-old',
      false,
    ),
    'local-old',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'local-legacy-old',
      false,
    ),
    'local-legacy-old',
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    ),
    undefined,
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(null, null, null, null, null, null, true),
    undefined,
  )

  assert.equal(
    resolveDefaultHomeActiveProfileId(
      null,
      null,
      null,
      null,
      null,
      null,
      false,
    ),
    undefined,
  )
})
