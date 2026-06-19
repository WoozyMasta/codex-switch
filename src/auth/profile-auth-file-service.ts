import type { AuthData, ProfileSummary } from '../types'
import { maybeSyncProfileAuthToCodexAuthFile } from '../utils/profile-live-auth-sync'
import { captureLiveAuthForMatchingProfile } from '../utils/profile-live-auth-sync'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import { findMatchingProfileIdForAuth } from '../utils/profile-auth-match'
import type { SyncFileSystem } from './runtime-adapters'

interface ProfileAuthFileServiceDeps {
  fs: SyncFileSystem
  getActiveCodexAuthPath: () => string
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  buildCodexAuthJson: (authData: AuthData) => string
  syncCodexAuthFile: (authPath: string, authData: AuthData) => void
  sha256Text: (text: string) => string
  listProfiles: () => Promise<ProfileSummary[]>
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
}

export class ProfileAuthFileService {
  private lastSyncedProfileId: string | undefined
  private lastSyncedAuthHash: string | undefined

  constructor(private readonly deps: ProfileAuthFileServiceDeps) {}

  async loadLiveCodexAuthData(): Promise<AuthData | null> {
    return this.deps.loadLiveCodexAuthData()
  }

  hasActiveCodexAuthFile(): boolean {
    return this.deps.fs.existsSync(this.deps.getActiveCodexAuthPath())
  }

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

  syncProfileAuthToCodexAuthFile(profileId: string, authData: AuthData): void {
    const content = this.deps.buildCodexAuthJson(authData)
    this.deps.syncCodexAuthFile(this.deps.getActiveCodexAuthPath(), authData)
    this.lastSyncedProfileId = profileId
    this.lastSyncedAuthHash = this.deps.sha256Text(content)
  }

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

  resetSyncCache(): void {
    this.lastSyncedProfileId = undefined
    this.lastSyncedAuthHash = undefined
  }

  async inferActiveProfileIdFromAuthFile(): Promise<string | undefined> {
    const authData = await this.loadLiveCodexAuthData()
    if (!authData) {
      return undefined
    }
    const profiles = await this.deps.listProfiles()
    return findMatchingProfileIdForAuth(profiles, authData)
  }
}
