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

interface ProfileStateServiceDeps {
  getActiveCodexHome: () => ResolvedCodexHome
  getConfiguration: ConfigurationGetter
  globalState: StateStore
  workspaceState: StateStore
  isRemoteFilesMode: () => boolean
  getProfile: (profileId: string) => Promise<ProfileSummary | undefined>
  loadAuthData: (profileId: string) => Promise<AuthData | null>
  loadLiveCodexAuthData: () => Promise<AuthData | null>
  inferActiveProfileIdFromAuthFile: () => Promise<string | undefined>
  recoverMissingTokens: (profileId: string) => Promise<AuthData | null>
  preserveStoredProfileAuthFromLive: (profileId: string) => Promise<void>
  syncProfileAuthToCodexAuthFile: (
    profileId: string,
    authData: AuthData,
  ) => void
  resetSyncCache: () => void
  readSharedActiveProfile: () => string | undefined
  readDefaultHomeSharedActiveProfileId: () => string | undefined
  readDefaultHomeSharedLegacyActiveProfileId: () => string | undefined
  writeSharedActiveProfile: (profileId: string) => void
  deleteSharedActiveProfile: () => void
  hasActiveCodexAuthFile: () => boolean
  deleteActiveCodexAuthFile: () => void
}

export class ProfileStateService {
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

  async prepareForNewLoginChat(): Promise<{ removedAuthFile: boolean }> {
    await this.setActiveProfileIdInState(undefined)
    this.deps.resetSyncCache()

    if (!this.deps.hasActiveCodexAuthFile()) {
      return { removedAuthFile: false }
    }

    this.deps.deleteActiveCodexAuthFile()

    return { removedAuthFile: true }
  }

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

  async syncActiveProfileFromDefaultHome(): Promise<string | undefined> {
    const defaultProfileId = await this.getDefaultHomeActiveProfileId()
    if (!defaultProfileId) {
      return undefined
    }
    const ok = await this.setActiveProfileId(defaultProfileId)
    return ok ? defaultProfileId : undefined
  }

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
