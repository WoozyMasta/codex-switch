import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProfilesFileState } from '../../src/utils/profiles-file-state'

test('parseProfilesFileState returns valid and corrupt typed states', () => {
  assert.deepEqual(
    parseProfilesFileState(
      JSON.stringify({ version: 1, profiles: [] }),
      '/tmp/profiles.json',
    ),
    {
      kind: 'valid',
      path: '/tmp/profiles.json',
      file: { version: 1, profiles: [] },
    },
  )

  assert.deepEqual(parseProfilesFileState('not-json', '/tmp/profiles.json'), {
    kind: 'corrupt',
    path: '/tmp/profiles.json',
    reason: 'Invalid profiles file format.',
  })
})
