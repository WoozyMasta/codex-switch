import type * as vscode from 'vscode'
import type { AuthData, ProfileSummary } from '../types'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import type { ProfileTokens } from '../utils/profile-records'

/**
 * Result of attempting to preserve live authentication to a matching profile.
 */
export interface LiveAuthPreservationResult {
  /** Status indicating whether live auth existed, was saved, or was unsaved. */
  status: 'noLiveAuth' | 'saved' | 'unsaved'
}

/**
 * Dependencies for ProfileAuthRecoveryService.
 */
interface ProfileAuthRecoveryServiceDeps {
  /** Function to get the currently active profile ID. */
  getActiveProfileId: () => Promise<string | undefined>
  /** Function to retrieve a profile by ID. */
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  /** Function to list all profiles. */
  listProfiles: () => Promise<ProfileSummary[]>
  /** Function to load authentication data for a profile. */
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  /** Function to load the current live Codex auth data. */
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  /** Function to get the active Codex auth file path. */
  getActiveCodexAuthPath: () => string
  /** Function to replace profile authentication data. */
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  /** Function to delete a profile. */
  deleteProfile: (profileId: string) => Promise<boolean>
  /** Function to read tokens from remote profile storage. */
  readRemoteProfileTokens: (profileId: string) => ProfileTokens | null
  /** Function to write tokens to storage. */
  writeStoredTokens: (profileId: string, tokens: ProfileTokens) => Promise<void>
  /** Function indicating whether remote files mode is enabled. */
  isRemoteFilesMode: () => boolean
  /** Function to show warning messages in the UI. */
  showWarningMessage: typeof vscode.window.showWarningMessage
  /** Function to show error messages in the UI. */
  showErrorMessage: typeof vscode.window.showErrorMessage
  /** Function to translate localized strings. */
  translate: typeof vscode.l10n.t
}

/**
 * Handles recovery of authentication data when tokens are missing or corrupted.
 * Assists with preserving live auth, recovering from remote storage, and importing from files.
 */
export class ProfileAuthRecoveryService {
  /**
   * Creates a new ProfileAuthRecoveryService instance.
   * @param deps - Dependencies for recovery operations.
   */
  constructor(private readonly deps: ProfileAuthRecoveryServiceDeps) {}

  /**
   * Preserves the stored profile's auth by updating it with current live auth if appropriate.
   * A best-effort operation that doesn't block profile switching on failure.
   * @param profileId - The ID of the profile to preserve auth for.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Attempts to preserve the current live Codex auth by finding and updating a matching profile.
   * @returns A promise that resolves to the preservation result.
   */
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

  /**
   * Recovers authentication tokens for a profile when they are missing or inaccessible.
   * Presents the user with options to recover from remote storage, import from the live auth file, or delete the profile.
   * @param profileId - The ID of the profile to recover tokens for.
   * @returns A promise that resolves to the recovered auth data, or null if recovery failed or was canceled.
   */
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
