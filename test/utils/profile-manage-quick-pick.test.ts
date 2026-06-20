/** Tests for profile-manage-quick-pick. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManageProfilesQuickPickItems } from '../../src/utils/profile-manage-quick-pick'

test('buildManageProfilesQuickPickItems includes conditional actions', () => {
  const items = buildManageProfilesQuickPickItems(
    'C:\\tmp\\auth.json',
    {
      id: 'home-1',
      name: 'home',
      fsPath: 'C:\\Users\\me\\.codex',
      envValue: 'C:\\Users\\me\\.codex',
      authPath: 'C:\\Users\\me\\.codex\\auth.json',
      source: 'environment',
      isDefault: false,
      usesPerHomeState: true,
    },
    true,
    {
      prepareForNewLogin: 'Prepare for New Login (Chat)',
      loginViaCodexCli: 'Login via Codex CLI...',
      switchProfile: 'Switch profile',
      addFromCurrentAuthJson: 'Add from current auth.json',
      importFromFile: 'Import from file...',
      exportProfiles: 'Export profiles...',
      importProfiles: 'Import profiles...',
      useDefaultProfileHere: 'Use default CODEX_HOME profile here',
      renameProfile: 'Rename profile',
      deleteProfile: 'Delete profile',
    },
  )

  assert.deepEqual(items, [
    {
      label: 'Prepare for New Login (Chat)',
      description:
        'Save current profile if possible, remove local auth.json, and reload Chat login',
      command: 'codex-switch.profile.prepareForNewLoginChat',
    },
    {
      label: 'Login via Codex CLI...',
      command: 'codex-switch.profile.login',
    },
    {
      label: 'Switch profile',
      command: 'codex-switch.profile.switch',
    },
    {
      label: 'Add from current auth.json',
      description: 'C:\\tmp\\auth.json',
      command: 'codex-switch.profile.addFromCodexAuthFile',
    },
    {
      label: 'Import from file...',
      command: 'codex-switch.profile.addFromFile',
    },
    {
      label: 'Export profiles...',
      command: 'codex-switch.profile.exportSettings',
    },
    {
      label: 'Import profiles...',
      command: 'codex-switch.profile.importSettings',
    },
    {
      label: 'Use default CODEX_HOME profile here',
      description: 'C:\\Users\\me\\.codex',
      command: 'codex-switch.profile.syncFromDefaultHome',
    },
    {
      label: 'Rename profile',
      command: 'codex-switch.profile.rename',
    },
    {
      label: 'Delete profile',
      command: 'codex-switch.profile.delete',
    },
  ])
})

test('buildManageProfilesQuickPickItems omits conditional actions', () => {
  const items = buildManageProfilesQuickPickItems(
    '/tmp/auth.json',
    {
      id: 'home-2',
      name: 'default',
      fsPath: '/home/me/.codex',
      envValue: '/home/me/.codex',
      authPath: '/home/me/.codex/auth.json',
      source: 'default',
      isDefault: true,
      usesPerHomeState: false,
    },
    false,
    {
      prepareForNewLogin: 'Prepare for New Login (Chat)',
      loginViaCodexCli: 'Login via Codex CLI...',
      switchProfile: 'Switch profile',
      addFromCurrentAuthJson: 'Add from current auth.json',
      importFromFile: 'Import from file...',
      exportProfiles: 'Export profiles...',
      importProfiles: 'Import profiles...',
      useDefaultProfileHere: 'Use default CODEX_HOME profile here',
      renameProfile: 'Rename profile',
      deleteProfile: 'Delete profile',
    },
  )

  assert.deepEqual(items, [
    {
      label: 'Prepare for New Login (Chat)',
      description:
        'Save current profile if possible, remove local auth.json, and reload Chat login',
      command: 'codex-switch.profile.prepareForNewLoginChat',
    },
    {
      label: 'Login via Codex CLI...',
      command: 'codex-switch.profile.login',
    },
    {
      label: 'Add from current auth.json',
      description: '/tmp/auth.json',
      command: 'codex-switch.profile.addFromCodexAuthFile',
    },
    {
      label: 'Import from file...',
      command: 'codex-switch.profile.addFromFile',
    },
    {
      label: 'Export profiles...',
      command: 'codex-switch.profile.exportSettings',
    },
    {
      label: 'Import profiles...',
      command: 'codex-switch.profile.importSettings',
    },
  ])
})
