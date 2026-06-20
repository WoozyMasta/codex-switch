import * as vscode from 'vscode'
import * as path from 'path'
import type { AuthData, ProfileSummary } from '../types'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import {
  getSharedActiveProfilesDir,
  getSharedProfilesDir,
  getSharedStoreRoot,
  SHARED_ACTIVE_PROFILE_FILENAME,
} from './shared-profile-store'

/**
 * Dependencies for ProfileAuthSyncService.
 */
interface ProfileAuthSyncServiceDeps {
  /** Function to get the currently active profile ID. */
  getActiveProfileId: () => Promise<string | undefined>
  /** Function to retrieve a profile by ID. */
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  /** Function to load authentication data for a profile. */
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  /** Function to load the current live Codex auth data. */
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  /** Function to get the active Codex auth file path. */
  getActiveCodexAuthPath: () => string
  /** Function to set the last active profile ID. */
  setLastProfileId: (profileId: string | undefined) => Promise<void>
  /** Function to write active profile ID to state. */
  setActiveProfileIdInState: (profileId: string | undefined) => Promise<void>
  /** Function to sync the active profile to the Codex auth file. */
  syncActiveProfileToCodexAuthFile: () => Promise<void>
  /** Function to capture live auth for a matching profile. */
  captureLiveAuthForMatchingProfile: (authPath: string) => Promise<void>
  /** Function to list all profiles. */
  listProfiles: () => Promise<ProfileSummary[]>
  /** Function to replace profile authentication data. */
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  /** Function to create file system watchers. */
  createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher
  /** Function to create file URIs. */
  uriFile: (path: string) => vscode.Uri
  /** Function to create relative glob patterns. */
  relativePattern: (base: vscode.Uri, pattern: string) => vscode.RelativePattern
  /** Function indicating whether remote files mode is enabled. */
  isRemoteFilesMode: () => boolean
}

/**
 * Manages synchronization between the Codex auth.json file and stored profiles.
 * Reconciles profile state when auth files change and creates file watchers to detect changes.
 */
export class ProfileAuthSyncService {
  /**
   * Creates a new ProfileAuthSyncService instance.
   * @param deps - Dependencies for auth file sync operations.
   */
  constructor(private readonly deps: ProfileAuthSyncServiceDeps) {}

  /**
   * Reconciles the active profile's state with the Codex auth.json file.
   * Handles cases where the auth file has been modified externally and may not
   * match the current active profile.
   * @returns A promise that resolves when reconciliation completes.
   */
  async reconcileActiveProfileWithCodexAuthFile(): Promise<void> {
    const activeId = await this.deps.getActiveProfileId()
    const activeProfile = activeId
      ? await this.deps.getProfile(activeId)
      : undefined
    const liveAuth = await this.deps.loadLiveCodexAuthData()

    if (liveAuth) {
      if (
        activeProfile &&
        (await maybeReplaceProfileAuthWithLive(
          {
            loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
            replaceProfileAuth: (profileId, authData) =>
              this.deps.replaceProfileAuth(profileId, authData),
          },
          activeProfile,
          liveAuth,
        ))
      ) {
        return
      }

      const matched = await findProfileByPreservationIdentity(
        {
          listProfiles: () => this.deps.listProfiles(),
          loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
        },
        liveAuth,
        activeProfile ? activeProfile.id : undefined,
      )
      if (matched) {
        if (activeProfile && activeId && activeId !== matched.id) {
          await this.deps.setLastProfileId(activeId)
        }
        await this.deps.setActiveProfileIdInState(matched.id)
        await maybeReplaceProfileAuthWithLive(
          {
            loadAuthData: (profileId) => this.deps.loadAuthData(profileId),
            replaceProfileAuth: (profileId, authData) =>
              this.deps.replaceProfileAuth(profileId, authData),
          },
          matched,
          liveAuth,
        )
        return
      }

      if (activeId) {
        await this.deps.setLastProfileId(activeId)
      }
      await this.deps.setActiveProfileIdInState(undefined)
      return
    }

    await this.deps.syncActiveProfileToCodexAuthFile()
  }

  /**
   * Creates file system watchers to monitor changes to the Codex auth file and shared profile state.
   * @param onChanged - Callback function invoked when watched files change.
   * @param authPath - Optional path to the auth file to watch; defaults to the active path.
   * @returns An array of disposables for the created watchers.
   */
  createWatchers(
    onChanged: () => void,
    authPath?: string,
  ): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = []
    const fire = () => {
      try {
        onChanged()
      } catch {
        // ignore refresh errors from file watchers
      }
    }

    const resolvedAuthPath = authPath
      ? authPath
      : this.deps.getActiveCodexAuthPath()
    let authDebounceTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleAuthCapture = () => {
      if (authDebounceTimer) {
        clearTimeout(authDebounceTimer)
      }
      authDebounceTimer = setTimeout(() => {
        void (async () => {
          try {
            await this.deps.captureLiveAuthForMatchingProfile(resolvedAuthPath)
          } catch {
            // Best-effort capture.
          }
          fire()
        })()
      }, 700)
    }

    disposables.push(
      new vscode.Disposable(() => {
        if (authDebounceTimer) {
          clearTimeout(authDebounceTimer)
        }
      }),
    )

    const authDir = path.dirname(resolvedAuthPath)
    const authWatcher = this.deps.createFileSystemWatcher(
      this.deps.relativePattern(this.deps.uriFile(authDir), 'auth.json'),
    )
    authWatcher.onDidCreate(scheduleAuthCapture)
    authWatcher.onDidChange(scheduleAuthCapture)
    authWatcher.onDidDelete(fire)
    disposables.push(authWatcher)

    if (this.deps.isRemoteFilesMode()) {
      const sharedRoot = this.deps.uriFile(getSharedStoreRoot())
      const profilesWatcher = this.deps.createFileSystemWatcher(
        this.deps.relativePattern(sharedRoot, 'profiles.json'),
      )
      profilesWatcher.onDidCreate(fire)
      profilesWatcher.onDidChange(fire)
      profilesWatcher.onDidDelete(fire)
      disposables.push(profilesWatcher)

      const activeWatcher = this.deps.createFileSystemWatcher(
        this.deps.relativePattern(
          this.deps.uriFile(getSharedActiveProfilesDir()),
          '*.json',
        ),
      )
      activeWatcher.onDidCreate(fire)
      activeWatcher.onDidChange(fire)
      activeWatcher.onDidDelete(fire)
      disposables.push(activeWatcher)

      const legacyActiveWatcher = this.deps.createFileSystemWatcher(
        this.deps.relativePattern(sharedRoot, SHARED_ACTIVE_PROFILE_FILENAME),
      )
      legacyActiveWatcher.onDidCreate(fire)
      legacyActiveWatcher.onDidChange(fire)
      legacyActiveWatcher.onDidDelete(fire)
      disposables.push(legacyActiveWatcher)

      const tokenWatcher = this.deps.createFileSystemWatcher(
        this.deps.relativePattern(
          this.deps.uriFile(getSharedProfilesDir()),
          '*.json',
        ),
      )
      tokenWatcher.onDidCreate(fire)
      tokenWatcher.onDidChange(fire)
      tokenWatcher.onDidDelete(fire)
      disposables.push(tokenWatcher)
    }

    return disposables
  }
}
