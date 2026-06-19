import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCurrentAuthJsonAsProfile,
  ensureCodexCliForRateLimits,
  ensureLiveAuthIsSavedBeforeReplacing,
} from '../../src/commands/profile-command-prompts'

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const deps = {
    getActiveCodexAuthPath: () => '/tmp/auth.json',
    getLoginCommandText: () => 'codex login',
    loadAuthDataFromFile: async () => ({
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      email: 'alice@example.com',
      planType: 'team',
    }),
    findDuplicateProfile: async () => undefined,
    replaceProfileAuth: async () => true,
    createProfile: async () => ({ id: 'new-profile' }),
    setActiveProfileId: async () => true,
    preserveLiveAuthForMatchingProfile: async () => ({
      status: 'unsaved' as const,
    }),
    updateCodexCliPath: async () => undefined,
    hasCodexCli: () => false,
    executeCommand: async () => undefined,
    showErrorMessage: (message: string) => {
      calls.push(`error:${message}`)
    },
    showInformationMessage: (message: string) => {
      calls.push(`info:${message}`)
      return undefined
    },
    showWarningMessage: async () => undefined,
    showInputBox: async () => 'profile',
    showOpenDialog: async () => [{ fsPath: '/bin/codex' }],
    translate: (_text: string, ...args: unknown[]) =>
      args.length ? `${_text} ${args.join(' ')}` : _text,
    restartAfterImport: async () => undefined,
    onAuthChanged: async () => undefined,
    calls,
  }

  return Object.assign(deps, overrides)
}

test('addCurrentAuthJsonAsProfile reports missing auth file', async () => {
  const deps = makeDeps({
    loadAuthDataFromFile: async () => null,
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addCurrentAuthJsonAsProfile replaces an existing profile and restarts', async () => {
  let restarted = 0
  let activated = 0
  const deps = makeDeps({
    findDuplicateProfile: async () => ({ id: 'existing', name: 'Existing' }),
    showWarningMessage: async () => 'Replace',
    replaceProfileAuth: async (profileId: string) => {
      assert.equal(profileId, 'existing')
      return true
    },
    setActiveProfileId: async (profileId: string) => {
      assert.equal(profileId, 'existing')
      activated++
      return true
    },
    restartAfterImport: async () => {
      restarted++
    },
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, true), true)
  assert.equal(activated, 1)
  assert.equal(restarted, 1)
})

test('addCurrentAuthJsonAsProfile reports replace failures', async () => {
  const deps = makeDeps({
    findDuplicateProfile: async () => ({ id: 'existing', name: 'Existing' }),
    showWarningMessage: async () => 'Replace',
    replaceProfileAuth: async () => false,
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addCurrentAuthJsonAsProfile reports activation failures for replaced profiles', async () => {
  const deps = makeDeps({
    findDuplicateProfile: async () => ({ id: 'existing', name: 'Existing' }),
    showWarningMessage: async () => 'Replace',
    setActiveProfileId: async () => false,
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addCurrentAuthJsonAsProfile reports activation failures', async () => {
  const deps = makeDeps({
    createProfile: async () => ({ id: 'new-profile' }),
    setActiveProfileId: async () => false,
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addCurrentAuthJsonAsProfile stops when replace is cancelled', async () => {
  const deps = makeDeps({
    findDuplicateProfile: async () => ({ id: 'existing', name: 'Existing' }),
    showWarningMessage: async () => undefined,
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, true), false)
})

test('addCurrentAuthJsonAsProfile stops on empty profile name', async () => {
  const deps = makeDeps({
    showInputBox: async () => '   ',
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
})

test('addCurrentAuthJsonAsProfile reports create failures', async () => {
  const deps = makeDeps({
    createProfile: async () => {
      throw new Error('boom')
    },
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addCurrentAuthJsonAsProfile reports unknown create failures', async () => {
  const deps = makeDeps({
    createProfile: async () => {
      throw 'boom'
    },
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, false), false)
  assert.match(
    (deps.calls as string[])[0] ?? '',
    /Unknown profile creation error\.|Failed to save the current auth as a profile: boom/,
  )
})

test('addCurrentAuthJsonAsProfile restarts after creating a profile', async () => {
  let restarted = 0
  const deps = makeDeps({
    showInputBox: async () => 'personal',
    restartAfterImport: async () => {
      restarted++
    },
  })

  assert.equal(await addCurrentAuthJsonAsProfile(deps as any, true), true)
  assert.equal(restarted, 1)
})

test('ensureLiveAuthIsSavedBeforeReplacing returns true for saved auth', async () => {
  const deps = makeDeps({
    preserveLiveAuthForMatchingProfile: async () => ({
      status: 'saved' as const,
    }),
  })

  assert.equal(
    await ensureLiveAuthIsSavedBeforeReplacing(deps as any, 'switch profiles'),
    true,
  )
})

test('ensureLiveAuthIsSavedBeforeReplacing lets the user save and continue', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => 'Save Profile and Continue',
    createProfile: async () => ({ id: 'new-profile' }),
    setActiveProfileId: async () => true,
  })

  assert.equal(
    await ensureLiveAuthIsSavedBeforeReplacing(deps as any, 'switch profiles'),
    true,
  )
})

test('ensureLiveAuthIsSavedBeforeReplacing continues without saving', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => 'Continue without saving',
  })

  assert.equal(
    await ensureLiveAuthIsSavedBeforeReplacing(deps as any, 'switch profiles'),
    true,
  )
})

test('ensureLiveAuthIsSavedBeforeReplacing stops when no choice is made', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => undefined,
  })

  assert.equal(
    await ensureLiveAuthIsSavedBeforeReplacing(deps as any, 'switch profiles'),
    false,
  )
})

test('ensureLiveAuthIsSavedBeforeReplacing stops on unexpected choice', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => 'Ignore',
  })

  assert.equal(
    await ensureLiveAuthIsSavedBeforeReplacing(deps as any, 'switch profiles'),
    false,
  )
})

test('ensureCodexCliForRateLimits returns true when CLI already exists', async () => {
  const deps = makeDeps({
    hasCodexCli: () => true,
  })

  assert.equal(await ensureCodexCliForRateLimits(deps as any), true)
})

test('ensureCodexCliForRateLimits opens settings when requested', async () => {
  const calls: string[] = []
  const deps = makeDeps({
    showWarningMessage: async () => 'Open Settings',
    executeCommand: async (command: string, arg: string) => {
      calls.push(`${command}:${arg}`)
    },
    calls,
  })

  assert.equal(await ensureCodexCliForRateLimits(deps as any), false)
  assert.deepEqual(calls, [
    'workbench.action.openSettings:codexSwitch.codexCliPath',
  ])
})

test('ensureCodexCliForRateLimits stores a selected CLI path', async () => {
  const calls: string[] = []
  const deps = makeDeps({
    showWarningMessage: async () => 'Set CLI Path',
    showOpenDialog: async () => [{ fsPath: '/opt/codex' }],
    updateCodexCliPath: async (path: string) => {
      calls.push(`path:${path}`)
    },
    showInformationMessage: (message: string) => {
      calls.push(`info:${message}`)
      return undefined
    },
    calls,
  })

  assert.equal(await ensureCodexCliForRateLimits(deps as any), true)
  assert.deepEqual(calls, ['path:/opt/codex', 'info:Codex CLI path saved.'])
})

test('ensureCodexCliForRateLimits omits executable filters off windows', async () => {
  const calls: string[] = []
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  assert.ok(originalPlatform)
  Object.defineProperty(process, 'platform', {
    value: 'linux',
  })

  try {
    const deps = makeDeps({
      showWarningMessage: async () => 'Set CLI Path',
      showOpenDialog: async (options: { filters?: unknown }) => {
        assert.equal(options.filters, undefined)
        return [{ fsPath: '/opt/codex' }]
      },
      updateCodexCliPath: async (path: string) => {
        calls.push(`path:${path}`)
      },
      showInformationMessage: (message: string) => {
        calls.push(`info:${message}`)
        return undefined
      },
      calls,
    })

    assert.equal(await ensureCodexCliForRateLimits(deps as any), true)
    assert.deepEqual(calls, ['path:/opt/codex', 'info:Codex CLI path saved.'])
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

test('ensureCodexCliForRateLimits stops when path selection is cancelled', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => 'Set CLI Path',
    showOpenDialog: async () => undefined,
  })

  assert.equal(await ensureCodexCliForRateLimits(deps as any), false)
})

test('ensureCodexCliForRateLimits stops when warning is dismissed', async () => {
  const deps = makeDeps({
    showWarningMessage: async () => undefined,
  })

  assert.equal(await ensureCodexCliForRateLimits(deps as any), false)
})
