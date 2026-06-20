import type { AuthData, ProfileSummary } from '../types'
import { shouldReplaceStoredProfileAuthWithLive } from '../utils/auth-refresh-policy'
import { resolveDefaultHomeActiveProfileId } from '../utils/shared-active-profile'
import { buildProfileStateKeys } from '../utils/profile-state-keys'
import {
  isNonDefaultPerHomeState,
  shouldMigrateLegacyProfileState,
} from '../utils/profile-state-policy'
import { resolveProfileStateBucket } from '../utils/profile-state-buckets'
import {
  resolveActiveProfileId,
  setActiveProfileIdInState,
} from '../utils/profile-active-state'
import {
  readLastProfileIdFromState,
  toggleLastProfileId,
  writeLastProfileIdToState,
} from '../utils/profile-last-state'
import { matchesPreservationIdentityForProfile } from '../utils/preservation-identity'
import type { ResolvedCodexHome } from '../types'
import type { ConfigurationGetter, StateStore } from './runtime-adapters'

const ACTIVE_PROFILE_KEY = 'codexSwitch.activeProfileId'
const LAST_PROFILE_KEY = 'codexSwitch.lastProfileId'
const OLD_ACTIVE_PROFILE_KEY = 'codexUsage.activeProfileId'
const OLD_LAST_PROFILE_KEY = 'codexUsage.lastProfileId'

/**
 * Dependencies for ProfileStateService.
 */
interface ProfileStateServiceDeps {
  /** Function to get the active Codex home configuration. */
  getActiveCodexHome: () => ResolvedCodexHome
  /** Configuration getter for accessing VS Code settings. */
  getConfiguration: ConfigurationGetter
  /** Global VS Code state storage. */
  globalState: StateStore
  /** Workspace-level VS Code state storage. */
  workspaceState: StateStore
  /** Function indicating whether remote files mode is enabled. */
  isRemoteFilesMode: () => boolean
  /** Function to retrieve a profile by ID. */
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  /** Function to load authentication data for a profile. */
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  /** Function to load the current live Codex authentication data. */
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  /** Function to infer active profile ID from auth file. */
  inferActiveProfileIdFromAuthFile: () => Promise<string | undefined>
  /** Function to recover missing tokens for a profile. */
  recoverMissingTokens: (profileId: string) => Promise<AuthData | null>
  /** Function to preserve stored profile auth from live auth file. */
  preserveStoredProfileAuthFromLive: (profileId: string) => Promise<void>
  /** Function to sync profile auth to Codex auth file. */
  syncProfileAuthToCodexAuthFile: (
    profileId: string,
    authData: AuthData,
  ) => void
  /** Function to reset internal sync cache. */
  resetSyncCache: () => void
  /** Function to read the shared active profile ID. */
  readSharedActiveProfile: () => string | undefined
  /** Function to read the default home shared active profile ID. */
  readDefaultHomeSharedActiveProfileId: () => string | undefined
  /** Function to read the default home legacy shared active profile ID. */
  readDefaultHomeSharedLegacyActiveProfileId: () => string | undefined
  /** Function to write a shared active profile marker. */
  writeSharedActiveProfile: (profileId: string) => void
  /** Function to delete the shared active profile marker. */
  deleteSharedActiveProfile: () => void
  /** Function to check if an active Codex auth file exists. */
  hasActiveCodexAuthFile: () => boolean
  /** Function to delete the active Codex auth file. */
  deleteActiveCodexAuthFile: () => void
}

/**
 * Manages the state of the active and last-used profiles.
 * Handles profile switching, history tracking, and state persistence
 * across global and workspace scopes.
 */
export class ProfileStateService {
  /**
   * Creates a new ProfileStateService instance.
   * @param deps - Dependencies for profile state management.
   */
  constructor(private readonly deps: ProfileStateServiceDeps) {}

  private getStateBucket(): StateStore {
    const newCfg = this.deps.getConfiguration('codexSwitch')
    const scopeFromNew = newCfg.get<'global' | 'workspace'>(
      'activeProfileScope',
    )
    const scope =
      scopeFromNew ||
      this.deps
        .getConfiguration('codexUsage')
        .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return resolveProfileStateBucket(
      scope,
      this.deps.globalState,
      this.deps.workspaceState,
    )
  }

  private getLegacyStateBucket(): StateStore {
    const scope = this.deps
      .getConfiguration('codexUsage')
      .get<'global' | 'workspace'>('activeProfileScope', 'global')
    return resolveProfileStateBucket(
      scope,
      this.deps.globalState,
      this.deps.workspaceState,
    )
  }

  private activeProfileKey(): string {
    return buildProfileStateKeys(this.deps.getActiveCodexHome().id).active
  }

  private lastProfileKey(): string {
    return buildProfileStateKeys(this.deps.getActiveCodexHome().id).last
  }

  private shouldMigrateLegacyProfileState(): boolean {
    return shouldMigrateLegacyProfileState(this.deps.getActiveCodexHome())
  }

  private shouldInheritDefaultProfileWhenEmpty(): boolean {
    const cfg = this.deps.getConfiguration('codexSwitch')
    return cfg.get<boolean>('codexHome.inheritDefaultProfileWhenEmpty', true)
  }

  private isNonDefaultPerHomeState(): boolean {
    return isNonDefaultPerHomeState(this.deps.getActiveCodexHome())
  }

  private isActiveCodexAuthFileMissing(): boolean {
    return !this.deps.hasActiveCodexAuthFile()
  }

  private async getDefaultHomeActiveProfileId(): Promise<string | undefined> {
    return resolveDefaultHomeActiveProfileId(
      this.deps.readDefaultHomeSharedActiveProfileId(),
      this.deps.readDefaultHomeSharedLegacyActiveProfileId(),
      this.getStateBucket().get<string>(`${ACTIVE_PROFILE_KEY}.default`),
      this.getStateBucket().get<string>(ACTIVE_PROFILE_KEY),
      this.getStateBucket().get<string>(OLD_ACTIVE_PROFILE_KEY),
      this.getLegacyStateBucket().get<string>(OLD_ACTIVE_PROFILE_KEY),
      this.deps.isRemoteFilesMode(),
    )
  }

  private async inheritDefaultProfileIfCurrentHomeIsEmpty(): Promise<
    string | undefined
  > {
    if (!this.isNonDefaultPerHomeState()) {
      return undefined
    }
    if (!this.shouldInheritDefaultProfileWhenEmpty()) {
      return undefined
    }
    if (!this.isActiveCodexAuthFileMissing()) {
      return undefined
    }

    const defaultProfileId = await this.getDefaultHomeActiveProfileId()
    if (!defaultProfileId) {
      return undefined
    }
    const existing = await this.deps.getProfile(defaultProfileId)
    if (!existing) {
      return undefined
    }

    await this.setActiveProfileIdInState(defaultProfileId)
    return defaultProfileId
  }

  /**
   * Gets the ID of the currently active profile.
   * Resolves state from both current and legacy storage keys.
   * @returns A promise that resolves to the active profile ID, or undefined if none is active.
   */
  async getActiveProfileId(): Promise<string | undefined> {
    return resolveActiveProfileId({
      isRemoteFilesMode: this.deps.isRemoteFilesMode(),
      currentBucket: this.getStateBucket(),
      legacyBucket: this.getLegacyStateBucket(),
      keys: {
        current: this.activeProfileKey(),
        currentBase: ACTIVE_PROFILE_KEY,
        legacy: OLD_ACTIVE_PROFILE_KEY,
      },
      shouldMigrateLegacyProfileState: this.shouldMigrateLegacyProfileState(),
      readSharedActiveProfile: () => this.deps.readSharedActiveProfile(),
      writeSharedActiveProfile: (profileId) =>
        this.deps.writeSharedActiveProfile(profileId),
      getProfile: (profileId) => this.deps.getProfile(profileId),
      inferActiveProfileIdFromAuthFile: () =>
        this.deps.inferActiveProfileIdFromAuthFile(),
      inheritDefaultProfileIfCurrentHomeIsEmpty: () =>
        this.inheritDefaultProfileIfCurrentHomeIsEmpty(),
    })
  }

  /**
   * Prepares the state for a new login in Codex chat.
   * Clears the active profile and optionally removes the auth file.
   * @returns A promise that resolves to the preparation result.
   */
  async prepareForNewLoginChat(): Promise<{ removedAuthFile: boolean }> {
    await this.setActiveProfileIdInState(undefined)
    this.deps.resetSyncCache()

    if (!this.deps.hasActiveCodexAuthFile()) {
      return { removedAuthFile: false }
    }

    this.deps.deleteActiveCodexAuthFile()

    return { removedAuthFile: true }
  }

  /**
   * Writes the active profile ID to state storage.
   * Updates both local and remote shared state as needed.
   * @param profileId - The profile ID to set as active, or undefined to clear.
   * @returns A promise that resolves when the operation completes.
   */
  async setActiveProfileIdInState(
    profileId: string | undefined,
  ): Promise<void> {
    await setActiveProfileIdInState(
      {
        isRemoteFilesMode: this.deps.isRemoteFilesMode(),
        currentBucket: this.getStateBucket(),
        keys: {
          current: this.activeProfileKey(),
          legacy: OLD_ACTIVE_PROFILE_KEY,
        },
        writeSharedActiveProfile: (profileId) =>
          this.deps.writeSharedActiveProfile(profileId),
        deleteSharedActiveProfile: () => this.deps.deleteSharedActiveProfile(),
      },
      profileId,
    )
  }

  /**
   * Sets the currently active profile by ID.
   * Loads auth data, preserves previous auth, and syncs to the Codex auth file.
   * @param profileId - The profile ID to activate, or undefined to deactivate all profiles.
   * @returns A promise that resolves to true if successful, false if auth data could not be loaded.
   */
  async setActiveProfileId(profileId: string | undefined): Promise<boolean> {
    const prev = await this.getActiveProfileId()

    let authData: AuthData | null = null
    if (profileId) {
      authData = await this.deps.loadAuthData(profileId)
      if (!authData) {
        authData = await this.deps.recoverMissingTokens(profileId)
        if (!authData) {
          return false
        }
      }
    }

    if (prev && profileId && prev === profileId) {
      if (!authData) {
        return false
      }
      const selectedProfile = await this.deps.getProfile(profileId)
      const liveAuth = await this.deps.loadLiveCodexAuthData()
      if (selectedProfile && liveAuth) {
        if (
          matchesPreservationIdentityForProfile(
            selectedProfile,
            liveAuth,
            authData,
          )
        ) {
          if (shouldReplaceStoredProfileAuthWithLive(authData, liveAuth)) {
            await this.deps.syncProfileAuthToCodexAuthFile(profileId, authData)
          }
          return true
        }
      }
      this.deps.syncProfileAuthToCodexAuthFile(profileId, authData)
      return true
    }

    if (prev && profileId && prev !== profileId) {
      await this.deps.preserveStoredProfileAuthFromLive(prev)
      await this.setLastProfileId(prev)
    }

    await this.setActiveProfileIdInState(profileId)

    if (profileId && authData) {
      this.deps.syncProfileAuthToCodexAuthFile(profileId, authData)
    }
    return true
  }

  /**
   * Synchronizes the active profile from the default home's shared state.
   * Only applicable in remote files mode.
   * @returns A promise that resolves to the synced profile ID, or undefined if not found.
   */
  async syncActiveProfileFromDefaultHome(): Promise<string | undefined> {
    const defaultProfileId = await this.getDefaultHomeActiveProfileId()
    if (!defaultProfileId) {
      return undefined
    }
    const ok = await this.setActiveProfileId(defaultProfileId)
    return ok ? defaultProfileId : undefined
  }

  /**
   * Gets the ID of the last active profile before the current one.
   * @returns A promise that resolves to the last profile ID, or undefined if no previous profile exists.
   */
  async getLastProfileId(): Promise<string | undefined> {
    return readLastProfileIdFromState(
      this.getStateBucket(),
      this.getLegacyStateBucket(),
      {
        current: this.lastProfileKey(),
        currentBase: LAST_PROFILE_KEY,
        legacy: OLD_LAST_PROFILE_KEY,
      },
      this.shouldMigrateLegacyProfileState(),
    )
  }

  /**
   * Sets the ID of the last active profile.
   * @param profileId - The profile ID to store, or undefined to clear the last profile.
   * @returns A promise that resolves when the operation completes.
   */
  async setLastProfileId(profileId: string | undefined): Promise<void> {
    await writeLastProfileIdToState(
      this.getStateBucket(),
      {
        current: this.lastProfileKey(),
        currentBase: LAST_PROFILE_KEY,
        legacy: OLD_LAST_PROFILE_KEY,
      },
      profileId,
    )
  }

  /**
   * Toggles between the current and previous active profiles.
   * @returns A promise that resolves to the newly activated profile ID, or undefined if toggle failed.
   */
  async toggleLastProfileId(): Promise<string | undefined> {
    const active = await this.getActiveProfileId()
    const last = await this.getLastProfileId()
    return toggleLastProfileId(
      active,
      last,
      async (profileId) => this.setActiveProfileId(profileId),
      async (profileId) => this.setLastProfileId(profileId),
    )
  }
}
