/** Tests for profile-storage-paths. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as path from 'path'
import test from 'node:test'
import { resolveProfilesPath } from '../../src/utils/profile-storage-paths'

test('resolveProfilesPath returns shared or local profiles.json path', () => {
  assert.equal(
    resolveProfilesPath(true, 'C:\\tmp\\codex-switch'),
    path.join(os.homedir(), '.codex-switch', 'profiles.json'),
  )

  assert.equal(
    resolveProfilesPath(false, 'C:\\tmp\\codex-switch'),
    path.join('C:\\tmp\\codex-switch', 'profiles.json'),
  )
})
