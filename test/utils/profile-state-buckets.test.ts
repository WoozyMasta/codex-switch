/** Tests for profile-state-buckets. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProfileStateBucket } from '../../src/utils/profile-state-buckets'

test('resolveProfileStateBucket selects the matching scope bucket', () => {
  assert.equal(
    resolveProfileStateBucket('global', 'global-bucket', 'workspace-bucket'),
    'global-bucket',
  )
  assert.equal(
    resolveProfileStateBucket('workspace', 'global-bucket', 'workspace-bucket'),
    'workspace-bucket',
  )
})
