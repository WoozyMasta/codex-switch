import type { AuthData, ProfileSummary } from '../types'
import { maybeSyncProfileAuthToCodexAuthFile } from '../utils/profile-live-auth-sync'
import { captureLiveAuthForMatchingProfile } from '../utils/profile-live-auth-sync'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import { findMatchingProfileIdForAuth } from '../utils/profile-auth-match'
import type { SyncFileSystem } from './runtime-adapters'

/**
 * Dependencies for ProfileAuthFileService.
 */
interface ProfileAuthFileServiceDeps {
  /** File system operations adapter. */
  fs: SyncFileSystem
  /** Function to get the path to the active Codex auth file. */
  getActiveCodexAuthPath: () => string
  /** Function to load live Codex auth data from the auth file. */
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  /** Function to build Codex auth.json content from auth data. */
  buildCodexAuthJson: (authData: AuthData) => string
  /** Function to sync auth data to the Codex auth file. */
  syncCodexAuthFile: (authPath: string, authData: AuthData) => void
  /** Function to compute SHA256 hash of text. */
  sha256Text: (text: string) => string
  /** Function to list all profiles. */
  listProfiles: () => Promise<ProfileSummary[]>
  /** Function to load auth data for a profile. */
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  /** Function to replace auth data for a profile. */
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
}

/**
 * Manages synchronization between profile authentication and the Codex auth.json file.
 * Handles reading/writing the live auth file and detecting changes.
 */
export class ProfileAuthFileService {
  private lastSyncedProfileId: string | undefined
  private lastSyncedAuthHash: string | undefined

  /**
   * Creates a new ProfileAuthFileService instance.
   * @param deps - Dependencies for file sync operations.
   */
  constructor(private readonly deps: ProfileAuthFileServiceDeps) {}

  /**
   * Loads the current live Codex authentication data from the auth file.
   * @returns A promise that resolves to the live auth data, or null if not available.
   */
  async loadLiveCodexAuthData(): Promise<AuthData | null> {
    return this.deps.loadLiveCodexAuthData()
  }

  /**
   * Checks if the active Codex auth file exists.
   * @returns True if the auth file exists, false otherwise.
   */
  hasActiveCodexAuthFile(): boolean {
    return this.deps.fs.existsSync(this.deps.getActiveCodexAuthPath())
  }

  /**
   * Deletes the active Codex auth file if it exists.
   */
  deleteActiveCodexAuthFile(): void {
    const authPath = this.deps.getActiveCodexAuthPath()
    if (this.deps.fs.existsSync(authPath)) {
      this.deps.fs.unlinkSync(authPath)
    }
  }

  private readAuthFileHash(authPath: string): string | undefined {
    try {
      if (!this.deps.fs.existsSync(authPath)) {
        return undefined
      }
      const content = this.deps.fs.readFileSync(authPath, 'utf8')
      return this.deps.sha256Text(content)
    } catch {
      return undefined
    }
  }

  /**
   * Synchronizes a profile's authentication data to the Codex auth file.
   * @param profileId - The ID of the profile.
   * @param authData - The authentication data to sync.
   */
  syncProfileAuthToCodexAuthFile(profileId: string, authData: AuthData): void {
    const content = this.deps.buildCodexAuthJson(authData)
    this.deps.syncCodexAuthFile(this.deps.getActiveCodexAuthPath(), authData)
    this.lastSyncedProfileId = profileId
    this.lastSyncedAuthHash = this.deps.sha256Text(content)
  }

  /**
   * Synchronizes the active profile's authentication to the Codex auth file.
   * Only syncs if the auth data has changed since the last sync.
   * @param activeProfileId - The ID of the currently active profile.
   * @returns A promise that resolves when synchronization completes.
   */
  async syncActiveProfileToCodexAuthFile(
    activeProfileId: string,
  ): Promise<void> {
    await maybeSyncProfileAuthToCodexAuthFile(
      {
        lastSyncedProfileId: this.lastSyncedProfileId,
        loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
        syncProfileAuthToCodexAuthFile: (profileId, authData) =>
          this.syncProfileAuthToCodexAuthFile(profileId, authData),
      },
      activeProfileId,
    )
  }

  /**
   * Captures live authentication from the Codex auth file and updates the matching profile if appropriate.
   * @param authPath - The path to the auth file to capture from.
   * @returns A promise that resolves when capture completes.
   */
  async captureLiveAuthForMatchingProfile(authPath: string): Promise<void> {
    await captureLiveAuthForMatchingProfile(
      {
        lastSyncedAuthHash: this.lastSyncedAuthHash,
        readAuthFileHash: (value) => this.readAuthFileHash(value),
        loadLiveCodexAuthData: () => this.loadLiveCodexAuthData(),
        findProfileByPreservationIdentity: (liveAuth, preferredProfileId) =>
          findProfileByPreservationIdentity(
            {
              listProfiles: () => this.deps.listProfiles(),
              loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
            },
            liveAuth,
            preferredProfileId,
          ),
        maybeReplaceProfileAuthWithLive: (profile, liveAuth) =>
          maybeReplaceProfileAuthWithLive(
            {
              loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
              replaceProfileAuth: (profileId, authData) =>
                this.deps.replaceProfileAuth(profileId, authData),
            },
            profile,
            liveAuth,
          ),
      },
      authPath,
    )
  }

  /**
   * Resets the internal sync cache to force re-sync on the next opportunity.
   */
  resetSyncCache(): void {
    this.lastSyncedProfileId = undefined
    this.lastSyncedAuthHash = undefined
  }

  /**
   * Infers the active profile ID by matching against the current Codex auth data.
   * @returns A promise that resolves to the matching profile ID, or undefined if no match.
   */
  async inferActiveProfileIdFromAuthFile(): Promise<string | undefined> {
    const authData = await this.loadLiveCodexAuthData()
    if (!authData) {
      return undefined
    }
    const profiles = await this.deps.listProfiles()
    return findMatchingProfileIdForAuth(profiles, authData)
  }
}
