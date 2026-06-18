import * as fs from 'fs'
import type { AuthData, ProfileSummary } from '../types'
import { loadAuthDataFromFile } from './auth-manager'
import { buildCodexAuthJson, syncCodexAuthFile } from './codex-auth-sync'
import { sha256Text } from '../utils/text-hash'
import { maybeSyncProfileAuthToCodexAuthFile } from '../utils/profile-live-auth-sync'
import { captureLiveAuthForMatchingProfile } from '../utils/profile-live-auth-sync'
import {
  findProfileByPreservationIdentity,
  maybeReplaceProfileAuthWithLive,
} from '../utils/profile-auth-preservation'
import { findMatchingProfileIdForAuth } from '../utils/profile-auth-match'

interface ProfileAuthFileServiceDeps {
  fs: typeof fs
  getActiveCodexAuthPath: () => string
  listProfiles: () => Promise<ProfileSummary[]>
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  replaceProfileAuth: (
    profileId: string,
    authData: AuthData,
  ) => Promise<boolean>
  getLastSyncedProfileId: () => string | undefined
  getLastSyncedAuthHash: () => string | undefined
  setLastSyncedProfileId: (profileId: string | undefined) => void
  setLastSyncedAuthHash: (hash: string | undefined) => void
}

export class ProfileAuthFileService {
  constructor(private readonly deps: ProfileAuthFileServiceDeps) {}

  async loadLiveCodexAuthData(): Promise<AuthData | null> {
    return loadAuthDataFromFile(this.deps.getActiveCodexAuthPath())
  }

  private readAuthFileHash(authPath: string): string | undefined {
    try {
      if (!this.deps.fs.existsSync(authPath)) {
        return undefined
      }
      const content = this.deps.fs.readFileSync(authPath, 'utf8')
      return sha256Text(content)
    } catch {
      return undefined
    }
  }

  syncProfileAuthToCodexAuthFile(profileId: string, authData: AuthData): void {
    const content = buildCodexAuthJson(authData)
    syncCodexAuthFile(this.deps.getActiveCodexAuthPath(), authData)
    this.deps.setLastSyncedProfileId(profileId)
    this.deps.setLastSyncedAuthHash(sha256Text(content))
  }

  async syncActiveProfileToCodexAuthFile(
    activeProfileId: string,
  ): Promise<void> {
    await maybeSyncProfileAuthToCodexAuthFile(
      {
        lastSyncedProfileId: this.deps.getLastSyncedProfileId(),
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
        lastSyncedAuthHash: this.deps.getLastSyncedAuthHash(),
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

  async inferActiveProfileIdFromAuthFile(): Promise<string | undefined> {
    const authData = await this.loadLiveCodexAuthData()
    if (!authData) {
      return undefined
    }
    const profiles = await this.deps.listProfiles()
    return findMatchingProfileIdForAuth(profiles, authData)
  }
}
