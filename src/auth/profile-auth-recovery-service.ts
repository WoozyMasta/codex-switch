import type * as vscode from 'vscode'
import type { AuthData, ProfileSummary } from '../types'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import type { ProfileTokens } from '../utils/profile-records'

export interface LiveAuthPreservationResult {
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

interface ProfileAuthRecoveryServiceDeps {
  getActiveProfileId: () => Promise<string | undefined>
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  listProfiles: () => Promise<ProfileSummary[]>
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  getActiveCodexAuthPath: () => string
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  deleteProfile: (profileId: string) => Promise<boolean>
  readRemoteProfileTokens: (profileId: string) => ProfileTokens | null
  writeStoredTokens: (profileId: string, tokens: ProfileTokens) => Promise<void>
  isRemoteFilesMode: () => boolean
  showWarningMessage: typeof vscode.window.showWarningMessage
  showErrorMessage: typeof vscode.window.showErrorMessage
  translate: typeof vscode.l10n.t
}

export class ProfileAuthRecoveryService {
  constructor(private readonly deps: ProfileAuthRecoveryServiceDeps) {}

  async preserveStoredProfileAuthFromLive(profileId: string): Promise<void> {
    try {
      const profile = await this.deps.getProfile(profileId)
      if (!profile) {
        return
      }

      const liveAuth = await this.deps.loadLiveCodexAuthData()
      if (!liveAuth) {
        return
      }

      await maybeReplaceProfileAuthWithLive(
        {
          loadAuthData: (value) => this.deps.loadAuthData(value),
          replaceProfileAuth: (value, authData) =>
            this.deps.replaceProfileAuth(value, authData),
        },
        profile,
        liveAuth,
      )
    } catch {
      // Best-effort preservation; switching should continue.
    }
  }

  async preserveLiveAuthForMatchingProfile(): Promise<LiveAuthPreservationResult> {
    const liveAuth = await this.deps.loadLiveCodexAuthData()
    if (!liveAuth) {
      return { status: 'noLiveAuth' }
    }

    const activeId = await this.deps.getActiveProfileId()
    const matchingProfile = await findProfileByPreservationIdentity(
      {
        listProfiles: () => this.deps.listProfiles(),
        loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
      },
      liveAuth,
      activeId,
    )

    if (!matchingProfile) {
      return { status: 'unsaved' }
    }

    await maybeReplaceProfileAuthWithLive(
      {
        loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
        replaceProfileAuth: (profileId, authData) =>
          this.deps.replaceProfileAuth(profileId, authData),
      },
      matchingProfile,
      liveAuth,
    )

    return { status: 'saved' }
  }

  async recoverMissingTokens(profileId: string): Promise<AuthData | null> {
    const profile = await this.deps.getProfile(profileId)
    const recoverLabel = this.deps.translate('Recover from remote store')
    const importLabel = this.deps.translate('Import current ~/.codex/auth.json')
    const deleteLabel = this.deps.translate('Delete broken profile')

    const canRecoverFromRemote =
      !this.deps.isRemoteFilesMode() &&
      this.deps.readRemoteProfileTokens(profileId) != null

    const pick = await this.deps.showWarningMessage(
      this.deps.translate(
        'Profile "{0}" is missing tokens. Restore it before switching.',
        profile?.name || profileId,
      ),
      { modal: true },
      ...(canRecoverFromRemote ? [recoverLabel] : []),
      importLabel,
      deleteLabel,
    )

    if (pick === recoverLabel) {
      const tokens = this.deps.readRemoteProfileTokens(profileId)
      if (tokens) {
        await this.deps.writeStoredTokens(profileId, tokens)
        return this.deps.loadAuthData(profileId)
      }
    }

    if (pick === importLabel) {
      const authData = await this.deps.loadLiveCodexAuthData()
      if (!authData) {
        void this.deps.showErrorMessage(
          this.deps.translate(
            'Could not read auth from {0}. Run "codex login" first.',
            this.deps.getActiveCodexAuthPath(),
          ),
        )
        return null
      }
      await this.deps.replaceProfileAuth(profileId, authData)
      return authData
    }

    if (pick === deleteLabel) {
      await this.deps.deleteProfile(profileId)
    }

    return null
  }
}
