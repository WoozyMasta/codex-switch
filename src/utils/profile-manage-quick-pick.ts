import type { ResolvedCodexHome } from '../types'

export interface ProfileManageQuickPickItem {
  label: string
  description?: string
  command: string
}

export interface ProfileManageQuickPickLabels {
  prepareForNewLogin: string
  loginViaCodexCli: string
  switchProfile: string
  addFromCurrentAuthJson: string
  importFromFile: string
  exportProfiles: string
  importProfiles: string
  useDefaultProfileHere: string
  renameProfile: string
  deleteProfile: string
}

export function buildManageProfilesQuickPickItems(
  authPath: string,
  home: ResolvedCodexHome,
  hasProfiles: boolean,
  labels: ProfileManageQuickPickLabels,
): ProfileManageQuickPickItem[] {
  return [
    {
      label: labels.prepareForNewLogin,
      description:
        'Save current profile if possible, remove local auth.json, and reload Chat login',
      command: 'codex-switch.profile.prepareForNewLoginChat',
    },
    {
      label: labels.loginViaCodexCli,
      command: 'codex-switch.profile.login',
    },
    ...(hasProfiles
      ? [
          {
            label: labels.switchProfile,
            command: 'codex-switch.profile.switch',
          },
        ]
      : []),
    {
      label: labels.addFromCurrentAuthJson,
      description: authPath,
      command: 'codex-switch.profile.addFromCodexAuthFile',
    },
    {
      label: labels.importFromFile,
      command: 'codex-switch.profile.addFromFile',
    },
    {
      label: labels.exportProfiles,
      command: 'codex-switch.profile.exportSettings',
    },
    {
      label: labels.importProfiles,
      command: 'codex-switch.profile.importSettings',
    },
    ...(home.usesPerHomeState && !home.isDefault
      ? [
          {
            label: labels.useDefaultProfileHere,
            description: home.fsPath,
            command: 'codex-switch.profile.syncFromDefaultHome',
          },
        ]
      : []),
    ...(hasProfiles
      ? [
          {
            label: labels.renameProfile,
            command: 'codex-switch.profile.rename',
          },
          {
            label: labels.deleteProfile,
            command: 'codex-switch.profile.delete',
          },
        ]
      : []),
  ]
}
