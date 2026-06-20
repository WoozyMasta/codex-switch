import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activateProfileCommand,
  loginCommand,
  switchProfileCommand,
  toggleLastProfileCommand,
} from '../../src/commands/profile-navigation-command-handlers'
import type { ProfileSummary } from '../../src/types'

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

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const warningResponses = [
    ...((overrides.warningResponses as unknown[]) ?? []),
  ]
  const profiles = (overrides.profiles as ProfileSummary[] | undefined) ?? [
    makeProfile(),
    makeProfile({ id: 'profile-2', name: 'Beta' }),
  ]
  const activeProfileId =
    (overrides.activeProfileId as string | undefined) ?? 'profile-1'
  const hasSyncProfileId = Object.prototype.hasOwnProperty.call(
    overrides,
    'toggleLastResult',
  )
  const toggleLastResult = hasSyncProfileId
    ? (overrides.toggleLastResult as string | undefined)
    : 'profile-2'
  const liveStatus =
    (overrides.liveStatus as 'saved' | 'unsaved' | 'noLiveAuth' | undefined) ??
    'saved'
  const quickPickMode =
    (overrides.quickPickMode as 'accept' | 'dismiss' | undefined) ?? 'accept'
  const selectedProfileId =
    (overrides.selectedProfileId as string | undefined) ?? 'profile-2'
  const clipboardWrites: string[] = []
  const quickPickState: {
    accept?: () => void
    hide?: () => void
  } = {}

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
      listProfiles: async () => profiles,
      getActiveProfileId: async () => activeProfileId,
      setActiveProfileId: async () => {
        const result = overrides.setActiveProfileIdResult as
          | boolean
          | (() => boolean | Promise<boolean>)
          | undefined
        if (typeof result === 'function') {
          return await result()
        }
        return result ?? true
      },
      toggleLastProfileId: async () => {
        const result = toggleLastResult as
          | string
          | undefined
          | (() => string | undefined | Promise<string | undefined>)
        if (typeof result === 'function') {
          return await result()
        }
        return result
      },
    },
    profileRateLimitService: {
      applyCachedRateLimits: (value: ProfileSummary[]) => value,
      decorateProfiles: async (_manager: unknown, value: ProfileSummary[]) =>
        value,
      getRefreshStatus: () => ({ isRefreshing: false }),
    },
    maybeRestartAfterProfileSwitch: async () => {
      calls.push('restart')
    },
    onAuthChanged: async () => {
      calls.push('auth')
    },
    createQuickPick: () => ({
      placeholder: '',
      items: [] as unknown[],
      busy: false,
      selectedItems: [{ profileId: selectedProfileId }],
      onDidAccept: (cb: () => void) => {
        quickPickState.accept = cb
        return { dispose: () => undefined }
      },
      onDidHide: (cb: () => void) => {
        quickPickState.hide = cb
        return { dispose: () => undefined }
      },
      show: () => {
        if (quickPickMode === 'accept') {
          queueMicrotask(() => {
            quickPickState.accept?.()
          })
        } else {
          queueMicrotask(() => {
            quickPickState.hide?.()
          })
        }
      },
      hide: () => {
        quickPickState.hide?.()
      },
      dispose: () => {
        calls.push('quickpick:dispose')
      },
    }),
    showInformationMessage: async (
      message: string,
      ...choices: Array<string | { modal?: boolean }>
    ) => {
      calls.push(`prompt:${message}`)
      const labels = choices.filter(
        (choice): choice is string => typeof choice === 'string',
      )
      return labels[0]
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
    getRateLimitAutoRefreshIntervalSeconds: () => 900,
    getLoginCommandText: () => 'codex login',
    createCodexTerminal: () => ({
      show: () => calls.push('terminal:show'),
      sendText: (text: string) => calls.push(`terminal:${text}`),
    }),
    runtimeHome: {},
    writeClipboardText: async (value: string) => {
      clipboardWrites.push(value)
    },
    getStatusBarClickBehavior: () =>
      (overrides.behavior as 'cycle' | 'toggleLast' | 'selector' | undefined) ??
      'cycle',
    clipboardWrites,
    calls,
  }

  return Object.assign(deps, overrides)
}

test('loginCommand opens manage profiles', async () => {
  const deps = makeDeps({
    showInformationMessage: async (_message: string, manage: string) => manage,
  })

  await loginCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.manage'),
  )
})

test('loginCommand opens the login terminal', async () => {
  const deps = makeDeps({
    showInformationMessage: async (
      _message: string,
      _manage: string,
      openTerminal: string,
    ) => openTerminal,
  })

  await loginCommand(deps as any)
  assert.deepEqual(deps.calls, ['terminal:show', 'terminal:codex login'])
})

test('loginCommand copies the command text', async () => {
  const deps = makeDeps({
    showInformationMessage: async (
      _message: string,
      _manage: string,
      _openTerminal: string,
      copyCommand: string,
    ) => copyCommand,
  })

  await loginCommand(deps as any)
  assert.deepEqual(deps.clipboardWrites as string[], ['codex login'])
})

test('switchProfileCommand delegates to manage when no profiles exist', async () => {
  const deps = makeDeps({
    profiles: [],
  })

  await switchProfileCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.manage'),
  )
})

test('switchProfileCommand switches the selected profile', async () => {
  const deps = makeDeps()

  await switchProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('auth'))
  assert.ok((deps.calls as string[]).includes('restart'))
})

test('switchProfileCommand stops when the picker is dismissed', async () => {
  const deps = makeDeps({
    quickPickMode: 'dismiss',
  })

  await switchProfileCommand(deps as any)
  assert.equal(
    (deps.calls as string[]).some((call) => call.startsWith('auth')),
    false,
  )
})

test('switchProfileCommand stops when live auth prompt is rejected', async () => {
  const deps = makeDeps({
    liveStatus: 'unsaved',
    warningResponses: [undefined],
  })

  await switchProfileCommand(deps as any)
  assert.deepEqual(deps.calls, [
    'quickpick:dispose',
    'warn:The current Codex account is not saved in Codex Switch. If you continue to switch profiles, this local login will be removed or overwritten and you will need to sign in again to recover it.',
  ])
})

test('switchProfileCommand ignores decoration failures', async () => {
  const deps = makeDeps({
    profileRateLimitService: {
      applyCachedRateLimits: (value: ProfileSummary[]) => value,
      decorateProfiles: async () => {
        throw new Error('decorate failed')
      },
      getRefreshStatus: () => ({ isRefreshing: false }),
    },
  })

  await switchProfileCommand(deps as any)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok((deps.calls as string[]).includes('auth'))
})

test('switchProfileCommand clears busy after async decoration resolves', async () => {
  const deps = makeDeps({
    profileRateLimitService: {
      applyCachedRateLimits: (value: ProfileSummary[]) => value,
      getRefreshStatus: () => ({ isRefreshing: false }),
      decorateProfiles: () =>
        new Promise<ProfileSummary[]>((resolve) => {
          setTimeout(
            () =>
              resolve([
                makeProfile(),
                makeProfile({ id: 'profile-2', name: 'Beta' }),
              ]),
            0,
          )
        }),
    },
    createQuickPick: () => ({
      placeholder: '',
      items: [] as unknown[],
      busy: false,
      selectedItems: [{ profileId: 'profile-2' }],
      onDidAccept: (cb: () => void) => {
        setTimeout(() => cb(), 50)
        return { dispose: () => undefined }
      },
      onDidHide: (cb: () => void) => {
        setTimeout(() => cb(), 50)
        return { dispose: () => undefined }
      },
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }),
  })

  await switchProfileCommand(deps as any)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok((deps.calls as string[]).includes('auth'))
})

test('activateProfileCommand delegates to switch when profile id is missing', async () => {
  const deps = makeDeps()

  await activateProfileCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.switch'),
  )
})

test('activateProfileCommand activates the requested profile', async () => {
  const deps = makeDeps()

  await activateProfileCommand(deps as any, 'profile-2')
  assert.ok((deps.calls as string[]).includes('auth'))
  assert.ok((deps.calls as string[]).includes('restart'))
})

test('activateProfileCommand stops when activation fails', async () => {
  const deps = makeDeps({
    setActiveProfileIdResult: false,
  })

  await activateProfileCommand(deps as any, 'profile-2')
  assert.equal((deps.calls as string[]).includes('auth'), false)
  assert.equal((deps.calls as string[]).includes('restart'), false)
})

test('toggleLastProfileCommand delegates to switch selector mode', async () => {
  const deps = makeDeps({
    behavior: 'selector',
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.switch'),
  )
})

test('toggleLastProfileCommand stops when live auth prompt is rejected', async () => {
  const deps = makeDeps({
    behavior: 'toggleLast',
    liveStatus: 'unsaved',
    warningResponses: [undefined],
  })

  await toggleLastProfileCommand(deps as any)
  assert.equal((deps.calls as string[]).includes('auth'), false)
  assert.equal((deps.calls as string[]).includes('restart'), false)
})

test('toggleLastProfileCommand falls back to switch when toggleLast returns nothing', async () => {
  const deps = makeDeps({
    behavior: 'toggleLast',
    toggleLastResult: undefined,
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.switch'),
  )
})

test('toggleLastProfileCommand toggles to the last profile', async () => {
  const deps = makeDeps({
    behavior: 'toggleLast',
    toggleLastResult: 'profile-2',
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('auth'))
  assert.ok((deps.calls as string[]).includes('restart'))
})

test('toggleLastProfileCommand delegates to manage when no profiles exist', async () => {
  const deps = makeDeps({
    profiles: [],
    behavior: 'cycle',
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok(
    (deps.calls as string[]).includes('cmd:codex-switch.profile.manage'),
  )
})

test('toggleLastProfileCommand cycles to the next profile', async () => {
  const deps = makeDeps({
    behavior: 'cycle',
    activeProfileId: 'profile-1',
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('auth'))
  assert.ok((deps.calls as string[]).includes('restart'))
})

test('toggleLastProfileCommand cycles from an unknown active profile', async () => {
  const deps = makeDeps({
    behavior: 'cycle',
    activeProfileId: 'missing',
  })

  await toggleLastProfileCommand(deps as any)
  assert.ok((deps.calls as string[]).includes('auth'))
  assert.ok((deps.calls as string[]).includes('restart'))
})

test('toggleLastProfileCommand stops when cycle activation fails', async () => {
  const deps = makeDeps({
    behavior: 'cycle',
    activeProfileId: 'profile-1',
    setActiveProfileIdResult: false,
  })

  await toggleLastProfileCommand(deps as any)
  assert.equal((deps.calls as string[]).includes('auth'), false)
  assert.equal((deps.calls as string[]).includes('restart'), false)
})
