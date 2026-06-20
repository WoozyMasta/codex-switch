/** Tests for legacy-profile-migration. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sortLegacyProfileMigrationCandidates } from '../../src/utils/legacy-profile-migration'

test('sortLegacyProfileMigrationCandidates prefers codex-switch then codex-stats', () => {
  assert.deepEqual(
    sortLegacyProfileMigrationCandidates([
      'zzz-other',
      'old-codex-stats',
      'old-codex-switch',
      'alpha',
    ]),
    ['old-codex-switch', 'old-codex-stats', 'zzz-other', 'alpha'],
  )
})
