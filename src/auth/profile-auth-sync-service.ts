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

interface ProfileAuthSyncServiceDeps {
  getActiveProfileId: () => Promise<string | undefined>
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  getActiveCodexAuthPath: () => string
  setLastProfileId: (profileId: string | undefined) => Promise<void>
  setActiveProfileIdInState: (profileId: string | undefined) => Promise<void>
  syncActiveProfileToCodexAuthFile: () => Promise<void>
  captureLiveAuthForMatchingProfile: (authPath: string) => Promise<void>
  listProfiles: () => Promise<ProfileSummary[]>
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher
  uriFile: (path: string) => vscode.Uri
  relativePattern: (base: vscode.Uri, pattern: string) => vscode.RelativePattern
  isRemoteFilesMode: () => boolean
}

export class ProfileAuthSyncService {
  constructor(private readonly deps: ProfileAuthSyncServiceDeps) {}

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
