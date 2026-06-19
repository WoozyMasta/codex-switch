import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deleteProfileCommand,
  manageProfilesCommand,
  prepareForNewLoginChatCommand,
  refreshRateLimitsCommand,
  renameProfileCommand,
  syncFromDefaultHomeCommand,
} from '../../src/commands/profile-management-command-handlers'
import type { ProfileSummary, ResolvedCodexHome } from '../../src/types'

function makeProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: 'profile-1',
    name: 'Alpha',
    email: 'alice@example.com',
    planType: 'team',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeHome(
  overrides: Partial<ResolvedCodexHome> = {},
): ResolvedCodexHome {
  return {
    id: 'home-1',
    name: 'home',
    fsPath: '/tmp',
    envValue: '/tmp',
    authPath: '/tmp/auth.json',
    source: 'default',
    isDefault: false,
    usesPerHomeState: true,
    ...overrides,
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const quickPickResponses = [
    ...((overrides.quickPickResponses as unknown[]) ?? []),
  ]
  const inputResponses = [...((overrides.inputResponses as unknown[]) ?? [])]
  const warningResponses = [
    ...((overrides.warningResponses as unknown[]) ?? []),
  ]
  const infoResponses = [...((overrides.infoResponses as unknown[]) ?? [])]
  const profiles = (overrides.profiles as ProfileSummary[] | undefined) ?? [
    makeProfile(),
  ]
  const activeProfileId =
    (overrides.activeProfileId as string | undefined) ?? 'profile-1'
  const hasSyncProfileId = Object.prototype.hasOwnProperty.call(
    overrides,
    'syncProfileId',
  )
  const syncProfileId = hasSyncProfileId
    ? (overrides.syncProfileId as string | undefined)
    : 'profile-1'
  const liveStatus =
    (overrides.liveStatus as 'saved' | 'unsaved' | 'noLiveAuth' | undefined) ??
    'saved'

  const deps = {
    promptDeps: {
      getActiveCodexAuthPath: () => '/tmp/auth.json',
      getLoginCommandText: () => 'codex login',
      loadAuthDataFromFile: async () => null,
      findDuplicateProfile: async () => undefined,
      replaceProfileAuth: async () => true,
      createProfile: async () => ({ id: 'profile-2' }),
      setActiveProfileId: async () => true,
      preserveLiveAuthForMatchingProfile: async () => ({
        status: liveStatus,
      }),
      updateCodexCliPath: async () => undefined,
      hasCodexCli: () => true,
      executeCommand: async () => undefined,
      showErrorMessage: (message: string) => {
        calls.push(`error:${message}`)
      },
      showInformationMessage: (message: string) => {
        calls.push(`info:${message}`)
        return undefined
      },
      showWarningMessage: async (
        message: string,
        ...choices: Array<string | { modal?: boolean }>
      ) => {
        calls.push(`warn:${message}`)
        const labels = choices.filter(
          (choice): choice is string => typeof choice === 'string',
        )
        return (
          warningResponses.length > 0 ? warningResponses.shift() : labels[0]
        ) as string | undefined
      },
      showInputBox: async () => 'profile',
      showOpenDialog: async () => [],
      translate: (text: string, ...args: unknown[]) => {
        let result = text
        for (const [index, arg] of args.entries()) {
          result = result.replace(
            new RegExp(`\\{${index}\\}`, 'g'),
            String(arg),
          )
        }
        return result
      },
      restartAfterImport: async () => undefined,
      onAuthChanged: async () => undefined,
      calls,
    },
    profileManager: {
      getActiveCodexAuthPath: () => '/tmp/auth.json',
      getActiveCodexHomeSummary: () => makeHome(),
      listProfiles: async () => profiles,
      getActiveProfileId: async () => activeProfileId,
      getProfile: async (profileId: string) =>
        ((overrides.getProfileById as
          | Record<string, ProfileSummary | undefined>
          | undefined) ?? {})[profileId],
      prepareForNewLoginChat: async () => {
        const result = overrides.prepareResult as
          | { removedAuthFile: boolean }
          | (() =>
              | { removedAuthFile: boolean }
              | Promise<{ removedAuthFile: boolean }>)
          | undefined
        if (typeof result === 'function') {
          return await result()
        }
        return result ?? { removedAuthFile: true }
      },
      renameProfile: async () => {
        const result = overrides.renameResult as
          | boolean
          | (() => boolean | Promise<boolean>)
          | undefined
        if (typeof result === 'function') {
          return await result()
        }
        return result ?? true
      },
      deleteProfile: async () => {
        const result = overrides.deleteResult as
          | boolean
          | (() => boolean | Promise<boolean>)
          | undefined
        if (typeof result === 'function') {
          return await result()
        }
        return result ?? true
      },
      syncActiveProfileFromDefaultHome: async () => {
        const result = overrides.syncProfileId as
          | string
          | undefined
          | (() => string | undefined | Promise<string | undefined>)
        if (typeof result === 'function') {
          return await result()
        }
        return result === undefined ? syncProfileId : result
      },
    },
    maybeRestartAfterProfileSwitch: async () => {
      calls.push('restart')
    },
    reloadAfterAuthReset: async () => {
      calls.push('reload')
    },
    onAuthChanged: async (options?: { forceRateLimitRefresh?: boolean }) => {
      calls.push(options?.forceRateLimitRefresh ? 'auth:refresh' : 'auth')
    },
    showQuickPick: async (
      items: readonly unknown[],
      options?: { placeHolder?: string },
    ) => {
      calls.push(`quickpick:${options?.placeHolder ?? ''}`)
      return (
        quickPickResponses.length > 0 ? quickPickResponses.shift() : items[0]
      ) as unknown | undefined
    },
    showInputBox: async (options: { prompt?: string; value?: string }) => {
      calls.push(`input:${options.prompt ?? ''}`)
      return (
        inputResponses.length > 0 ? inputResponses.shift() : 'renamed'
      ) as string | undefined
    },
    showWarningMessage: async (
      message: string,
      ...choices: Array<string | { modal?: boolean }>
    ) => {
      calls.push(`warn:${message}`)
      const labels = choices.filter(
        (choice): choice is string => typeof choice === 'string',
      )
      return (
        warningResponses.length > 0 ? warningResponses.shift() : labels[0]
      ) as string | undefined
    },
    showInformationMessage: async (
      message: string,
      ...choices: Array<string | { modal?: boolean }>
    ) => {
      calls.push(`info:${message}`)
      const labels = choices.filter(
        (choice): choice is string => typeof choice === 'string',
      )
      return (infoResponses.length > 0 ? infoResponses.shift() : labels[0]) as
        | string
        | undefined
    },
    showErrorMessage: (message: string) => {
      calls.push(`error:${message}`)
    },
    executeCommand: async (command: string) => {
      calls.push(`cmd:${command}`)
    },
    translate: (text: string, ...args: unknown[]) => {
      let result = text
      for (const [index, arg] of args.entries()) {
        result = result.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg))
      }
      return result
    },
    buildManageProfilesLabels: () => ({
      prepareForNewLogin: 'Prepare for New Login (Chat)',
      loginViaCodexCli: 'Login via Codex CLI...',
      switchProfile: 'Switch profile',
      addFromCurrentAuthJson: 'Add from current auth.json',
      importFromFile: 'Import from file...',
      exportProfiles: 'Export profiles...',
      importProfiles: 'Import profiles...',
      useDefaultProfileHere: 'Use default CODEX_HOME profile here',
      renameProfile: 'Rename profile',
      deleteProfile: 'Delete profile',
    }),
    calls,
  }

  return Object.assign(deps, overrides)
}

test('refreshRateLimitsCommand refreshes when CLI exists', async () => {
  const deps = makeDeps()

  await refreshRateLimitsCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('auth:refresh'))
})

test('refreshRateLimitsCommand stops when CLI setup is rejected', async () => {
  const deps = makeDeps({
    promptDeps: {
      ...(makeDeps().promptDeps as object),
      hasCodexCli: () => false,
      showWarningMessage: async () => undefined,
    },
  })

  await refreshRateLimitsCommand(deps as any)
  assert.equal((deps.calls as string[]).includes('auth:refresh'), false)
})

test('prepareForNewLoginChatCommand reuses saved auth and reloads', async () => {
  const deps = makeDeps({
    prepareResult: { removedAuthFile: true },
  })

  await prepareForNewLoginChatCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'auth',
    'info:Prepared for a new Codex login. The current auth.json was removed locally and the window will reload so Chat can show the login flow.',
    'reload',
  ])
})

test('prepareForNewLoginChatCommand reports missing auth and reloads', async () => {
  const deps = makeDeps({
    prepareResult: { removedAuthFile: false },
  })

  await prepareForNewLoginChatCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'auth',
    'info:Prepared for a new Codex login. No current auth.json was found and the window will reload so Chat can show the login flow.',
    'reload',
  ])
})

test('prepareForNewLoginChatCommand supports function results', async () => {
  const deps = makeDeps({
    prepareResult: async () => ({ removedAuthFile: true }),
  })

  await prepareForNewLoginChatCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('reload'))
})

test('prepareForNewLoginChatCommand stops when live auth prompt is rejected', async () => {
  const deps = makeDeps({
    liveStatus: 'unsaved',
    warningResponses: [undefined],
  })

  await prepareForNewLoginChatCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'warn:The current Codex account is not saved in Codex Switch. If you continue to prepare for a new login, this local login will be removed or overwritten and you will need to sign in again to recover it.',
  ])
})

test('manageProfilesCommand executes the selected action', async () => {
  const deps = makeDeps({
    quickPickResponses: [{ command: 'codex-switch.profile.rename' }],
  })

  await manageProfilesCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.rename'),
  )
})

test('manageProfilesCommand stops when dismissed', async () => {
  const deps = makeDeps({
    quickPickResponses: [undefined],
  })

  await manageProfilesCommand(deps as any)
  assert.equal(
    (deps.calls as string[]).some((call) => call.startsWith('cmd:')),
    false,
  )
})

test('renameProfileCommand renames the selected profile', async () => {
  const deps = makeDeps()

  await renameProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:Rename profile',
    'input:New profile name',
    'auth',
  ])
})

test('renameProfileCommand stops when no profiles exist', async () => {
  const deps = makeDeps({
    profiles: [],
  })

  await renameProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [])
})

test('renameProfileCommand stops when profile pick is dismissed', async () => {
  const deps = makeDeps({
    quickPickResponses: [undefined],
  })

  await renameProfileCommand(deps as any)
  assert.deepEqual(deps.calls, ['quickpick:Rename profile'])
})

test('renameProfileCommand stops when new name is dismissed', async () => {
  const deps = makeDeps({
    inputResponses: [undefined],
  })

  await renameProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:Rename profile',
    'input:New profile name',
  ])
})

test('renameProfileCommand reports failures', async () => {
  const deps = makeDeps({
    renameResult: false,
  })

  await renameProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).some((call) => call.startsWith('error:')))
})

test('renameProfileCommand reports empty-message errors', async () => {
  const deps = makeDeps({
    renameResult: async () => {
      throw new Error('')
    },
  })

  await renameProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).some((call) => call.startsWith('error:')))
})

test('deleteProfileCommand deletes the active profile and shows a notice', async () => {
  const deps = makeDeps()

  await deleteProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:Delete profile',
    'warn:Delete profile "Alpha"?',
    'auth',
    'info:Deleted the active profile. The current auth.json remains as an unsaved login.',
  ])
})

test('deleteProfileCommand deletes a non-active profile without a notice', async () => {
  const deps = makeDeps({
    activeProfileId: 'profile-2',
  })

  await deleteProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:Delete profile',
    'warn:Delete profile "Alpha"?',
    'auth',
  ])
})

test('deleteProfileCommand stops when no profiles exist', async () => {
  const deps = makeDeps({
    profiles: [],
  })

  await deleteProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [])
})

test('deleteProfileCommand stops when profile pick is dismissed', async () => {
  const deps = makeDeps({
    quickPickResponses: [undefined],
  })

  await deleteProfileCommand(deps as any)
  assert.deepEqual(deps.calls, ['quickpick:Delete profile'])
})

test('deleteProfileCommand stops when warning is dismissed', async () => {
  const deps = makeDeps({
    warningResponses: [undefined],
  })

  await deleteProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:Delete profile',
    'warn:Delete profile "Alpha"?',
  ])
})

test('deleteProfileCommand reports failed deletions', async () => {
  const deps = makeDeps({
    deleteResult: false,
  })

  await deleteProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).some((call) => call.startsWith('error:')))
})

test('deleteProfileCommand reports unknown failures', async () => {
  const deps = makeDeps({
    deleteResult: async () => {
      throw 'boom'
    },
  })

  await deleteProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).some((call) => call.startsWith('error:')))
})

test('syncFromDefaultHomeCommand reports empty default home', async () => {
  const deps = makeDeps({
    syncProfileId: undefined,
  })

  await syncFromDefaultHomeCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'info:Default CODEX_HOME has no active profile to sync.',
  ])
})

test('syncFromDefaultHomeCommand syncs and restarts', async () => {
  const deps = makeDeps({
    getProfileById: {
      'profile-1': makeProfile({ name: 'Synced profile' }),
    },
  })

  await syncFromDefaultHomeCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'auth',
    'restart',
    'info:Synced active profile from default CODEX_HOME: Synced profile.',
  ])
})

test('syncFromDefaultHomeCommand supports function-based resolution', async () => {
  const deps = makeDeps({
    syncProfileId: async () => 'profile-1',
    getProfileById: {
      'profile-1': makeProfile({ name: 'Function profile' }),
    },
  })

  await syncFromDefaultHomeCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'auth',
    'restart',
    'info:Synced active profile from default CODEX_HOME: Function profile.',
  ])
})

test('syncFromDefaultHomeCommand falls back to profile id when name is missing', async () => {
  const deps = makeDeps({
    getProfileById: {
      'profile-1': undefined,
    },
  })

  await syncFromDefaultHomeCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'auth',
    'restart',
    'info:Synced active profile from default CODEX_HOME: profile-1.',
  ])
})
