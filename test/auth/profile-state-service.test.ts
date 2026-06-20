/** Tests for profile-state-service. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthData,
  ProfileSummary,
  ResolvedCodexHome,
} from '../../src/types'
import { ProfileStateService } from '../../src/auth/profile-state-service'
import { buildProfileStateKeys } from '../../src/utils/profile-state-keys'

class MemoryBucket {
  private readonly values = new Map<string, unknown>()

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value)
    }
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key)
      return
    }
    this.values.set(key, value)
  }
}

function makeProfile(id: string): ProfileSummary {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    planType: 'pro',
    createdAt: '2026-06-12T10:00:00.000Z',
    updatedAt: '2026-06-12T10:00:00.000Z',
  }
}

function makeAuth(id: string): AuthData {
  return {
    idToken: `${id}-id`,
    accessToken: `${id}-access`,
    refreshToken: `${id}-refresh`,
    email: `${id}@example.com`,
    planType: 'pro',
    authJson: {
      tokens: {
        id_token: `${id}-id`,
        access_token: `${id}-access`,
        refresh_token: `${id}-refresh`,
      },
    },
  }
}

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const currentBucket = new MemoryBucket()
  const legacyBucket = new MemoryBucket()
  const sharedWrites: Array<string | undefined> = []
  const deletes: string[] = []
  const authDeletes: number[] = []
  const syncs: string[] = []
  const resets: number[] = []
  const preserved: string[] = []

  const service = new ProfileStateService({
    getActiveCodexHome: () =>
      ({
        id: 'home-1',
        name: 'home-1',
        fsPath: '/tmp/home-1',
        envValue: '/tmp/home-1',
        authPath: '/tmp/home-1/auth.json',
        source: 'environment',
        isDefault: false,
        usesPerHomeState: true,
      }) as ResolvedCodexHome,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return 'global'
        }
        if (
          section === 'codexSwitch' &&
          key === 'codexHome.inheritDefaultProfileWhenEmpty'
        ) {
          return true
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'global'
        }
        return fallback
      },
    })) as any,
    globalState: currentBucket as any,
    workspaceState: legacyBucket as any,
    isRemoteFilesMode: () => false,
    getProfile: async (profileId: string) =>
      profileId === 'default-profile' ||
      profileId === 'active' ||
      profileId === 'last'
        ? makeProfile(profileId)
        : undefined,
    loadAuthData: async (profileId: string) => makeAuth(profileId),
    loadLiveCodexAuthData: async () => makeAuth('live'),
    inferActiveProfileIdFromAuthFile: async () => undefined,
    recoverMissingTokens: async () => null,
    preserveStoredProfileAuthFromLive: async (profileId: string) => {
      preserved.push(profileId)
    },
    syncProfileAuthToCodexAuthFile: (profileId: string) => {
      syncs.push(profileId)
    },
    resetSyncCache: () => {
      resets.push(1)
    },
    readSharedActiveProfile: () => undefined,
    readDefaultHomeSharedActiveProfileId: () => 'default-profile',
    readDefaultHomeSharedLegacyActiveProfileId: () => undefined,
    writeSharedActiveProfile: (profileId) => {
      sharedWrites.push(profileId)
    },
    deleteSharedActiveProfile: () => {
      deletes.push('shared')
    },
    hasActiveCodexAuthFile: () => true,
    deleteActiveCodexAuthFile: () => {
      authDeletes.push(1)
    },
    ...overrides,
  })

  return {
    service,
    currentBucket,
    legacyBucket,
    sharedWrites,
    deletes,
    authDeletes,
    syncs,
    resets,
    preserved,
  }
}

test('ProfileStateService prepareForNewLoginChat clears active state and auth file', async () => {
  const stateKeys = buildProfileStateKeys('home-1')
  const state = new MemoryBucket({
    [stateKeys.active]: 'active',
    [stateKeys.last]: 'legacy',
  })
  const service = new ProfileStateService({
    getActiveCodexHome: () =>
      ({
        id: 'home-1',
        name: 'home-1',
        fsPath: '/tmp/home-1',
        envValue: '/tmp/home-1',
        authPath: '/tmp/home-1/auth.json',
        source: 'environment',
        isDefault: false,
        usesPerHomeState: true,
      }) as ResolvedCodexHome,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return 'global'
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'global'
        }
        return fallback
      },
    })) as any,
    globalState: state as any,
    workspaceState: new MemoryBucket() as any,
    isRemoteFilesMode: () => false,
    getProfile: async () => undefined,
    loadAuthData: async () => null,
    loadLiveCodexAuthData: async () => null,
    inferActiveProfileIdFromAuthFile: async () => undefined,
    recoverMissingTokens: async () => null,
    preserveStoredProfileAuthFromLive: async () => undefined,
    syncProfileAuthToCodexAuthFile: async () => undefined,
    resetSyncCache: () => undefined,
    readSharedActiveProfile: () => undefined,
    readDefaultHomeSharedActiveProfileId: () => undefined,
    readDefaultHomeSharedLegacyActiveProfileId: () => undefined,
    writeSharedActiveProfile: () => undefined,
    deleteSharedActiveProfile: () => undefined,
    hasActiveCodexAuthFile: () => true,
    deleteActiveCodexAuthFile: () => {
      state.update('deleted', true)
    },
  } as any)

  assert.deepEqual(await service.prepareForNewLoginChat(), {
    removedAuthFile: true,
  })
  assert.equal(state.get(stateKeys.active), undefined)
  assert.equal(state.get(stateKeys.last), 'legacy')
  assert.equal(state.get('deleted'), true)
})

test('ProfileStateService syncActiveProfileFromDefaultHome inherits the default profile when empty', async () => {
  const state = new MemoryBucket()
  const stateKeys = buildProfileStateKeys('home-1')
  const { service, sharedWrites } = makeService({
    globalState: state,
    workspaceState: new MemoryBucket(),
    isRemoteFilesMode: () => true,
    hasActiveCodexAuthFile: () => false,
  })

  assert.equal(
    await service.syncActiveProfileFromDefaultHome(),
    'default-profile',
  )
  assert.deepEqual(sharedWrites, ['default-profile'])
  assert.equal(state.get(stateKeys.active), undefined)
})

test('ProfileStateService toggleLastProfileId swaps active and last ids', async () => {
  const stateKeys = buildProfileStateKeys('home-1')
  const state = new MemoryBucket({
    [stateKeys.active]: 'active',
    [stateKeys.last]: 'last',
  })
  const service = new ProfileStateService({
    getActiveCodexHome: () =>
      ({
        id: 'home-1',
        name: 'home-1',
        fsPath: '/tmp/home-1',
        envValue: '/tmp/home-1',
        authPath: '/tmp/home-1/auth.json',
        source: 'environment',
        isDefault: false,
        usesPerHomeState: true,
      }) as ResolvedCodexHome,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return 'global'
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'global'
        }
        return fallback
      },
    })) as any,
    globalState: state as any,
    workspaceState: new MemoryBucket() as any,
    isRemoteFilesMode: () => false,
    getProfile: async (profileId: string) =>
      profileId === 'active' || profileId === 'last'
        ? makeProfile(profileId)
        : undefined,
    loadAuthData: async (profileId: string) => makeAuth(profileId),
    loadLiveCodexAuthData: async () => null,
    inferActiveProfileIdFromAuthFile: async () => undefined,
    recoverMissingTokens: async () => null,
    preserveStoredProfileAuthFromLive: async () => undefined,
    syncProfileAuthToCodexAuthFile: async () => undefined,
    resetSyncCache: () => undefined,
    readSharedActiveProfile: () => undefined,
    readDefaultHomeSharedActiveProfileId: () => undefined,
    readDefaultHomeSharedLegacyActiveProfileId: () => undefined,
    writeSharedActiveProfile: () => undefined,
    deleteSharedActiveProfile: () => undefined,
    hasActiveCodexAuthFile: () => false,
    deleteActiveCodexAuthFile: () => undefined,
  } as any)

  assert.equal(await service.toggleLastProfileId(), 'last')
  assert.equal(state.get(stateKeys.active), 'last')
  assert.equal(state.get(stateKeys.last), 'active')
})

test('ProfileStateService uses workspace scope from codexSwitch configuration', async () => {
  const stateKeys = buildProfileStateKeys('home-1')
  const globalState = new MemoryBucket()
  const workspaceState = new MemoryBucket()
  const { service } = makeService({
    globalState,
    workspaceState,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return 'workspace'
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'global'
        }
        return fallback
      },
    })) as any,
  })

  await service.setActiveProfileIdInState('workspace-active')

  assert.equal(workspaceState.get(stateKeys.active), 'workspace-active')
  assert.equal(globalState.get(stateKeys.active), undefined)
})

test('ProfileStateService falls back to codexUsage scope when codexSwitch omits it', async () => {
  const stateKeys = buildProfileStateKeys('home-1')
  const globalState = new MemoryBucket()
  const workspaceState = new MemoryBucket()
  const { service } = makeService({
    globalState,
    workspaceState,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return undefined
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'workspace'
        }
        return fallback
      },
    })) as any,
  })

  await service.setLastProfileId('workspace-last')

  assert.equal(workspaceState.get(stateKeys.last), 'workspace-last')
  assert.equal(globalState.get(stateKeys.last), undefined)
})

test('ProfileStateService getActiveProfileId ignores unsupported inheritance cases', async () => {
  const disabledInheritance = makeService({
    isRemoteFilesMode: () => true,
    hasActiveCodexAuthFile: () => false,
    getConfiguration: ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === 'codexSwitch' && key === 'activeProfileScope') {
          return 'global'
        }
        if (
          section === 'codexSwitch' &&
          key === 'codexHome.inheritDefaultProfileWhenEmpty'
        ) {
          return false
        }
        if (section === 'codexUsage' && key === 'activeProfileScope') {
          return 'global'
        }
        return fallback
      },
    })) as any,
  })

  assert.equal(
    await disabledInheritance.service.getActiveProfileId(),
    undefined,
  )
  assert.deepEqual(disabledInheritance.sharedWrites, [])

  const defaultHome = makeService({
    isRemoteFilesMode: () => true,
    getActiveCodexHome: () =>
      ({
        id: 'home-1',
        name: 'home-1',
        fsPath: '/tmp/home-1',
        envValue: '/tmp/home-1',
        authPath: '/tmp/home-1/auth.json',
        source: 'environment',
        isDefault: true,
        usesPerHomeState: false,
      }) as ResolvedCodexHome,
    hasActiveCodexAuthFile: () => false,
  })

  assert.equal(await defaultHome.service.getActiveProfileId(), undefined)
  assert.deepEqual(defaultHome.sharedWrites, [])

  const missingDefaultProfile = makeService({
    isRemoteFilesMode: () => true,
    hasActiveCodexAuthFile: () => false,
    getProfile: async () => undefined,
  })

  assert.equal(
    await missingDefaultProfile.service.getActiveProfileId(),
    undefined,
  )
  assert.deepEqual(missingDefaultProfile.sharedWrites, [])

  const activeAuthPresent = makeService({
    isRemoteFilesMode: () => true,
    hasActiveCodexAuthFile: () => true,
  })

  assert.equal(await activeAuthPresent.service.getActiveProfileId(), undefined)
  assert.deepEqual(activeAuthPresent.sharedWrites, [])
})

test('ProfileStateService getActiveProfileId syncs remote inferred auth back to shared state', async () => {
  const { service, sharedWrites } = makeService({
    isRemoteFilesMode: () => true,
    readSharedActiveProfile: () => 'shared',
    inferActiveProfileIdFromAuthFile: async () => 'inferred',
  })

  assert.equal(await service.getActiveProfileId(), 'inferred')
  assert.deepEqual(sharedWrites, ['inferred'])
})
