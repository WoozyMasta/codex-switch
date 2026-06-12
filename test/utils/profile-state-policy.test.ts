import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedCodexHome } from '../../src/types'
import {
  isNonDefaultPerHomeState,
  shouldMigrateLegacyProfileState,
} from '../../src/utils/profile-state-policy'

const defaultHome = {
  usesPerHomeState: false,
  isDefault: true,
} as ResolvedCodexHome

const customHome = {
  usesPerHomeState: true,
  isDefault: false,
} as ResolvedCodexHome

test('profile state policy follows home defaults and per-home mode', () => {
  assert.equal(shouldMigrateLegacyProfileState(defaultHome), true)
  assert.equal(shouldMigrateLegacyProfileState(customHome), false)
  assert.equal(isNonDefaultPerHomeState(defaultHome), false)
  assert.equal(isNonDefaultPerHomeState(customHome), true)
})
