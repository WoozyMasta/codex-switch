/** Tests for profile-login-command-handlers. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loginViaCli } from '../../src/commands/profile-login-command-handlers'

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const watcherCallbacks: Array<
    (event: string, filename?: string | Buffer) => Promise<void> | void
  > = []
  const responses = [...((overrides.responses as unknown[]) ?? [])]
  const deps = {
    promptDeps: {
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
      createProfile: async () => ({ id: 'profile-id' }),
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
      showWarningMessage: async () => 'Continue without saving',
      showInputBox: async () => 'profile',
      showOpenDialog: async () => [{ fsPath: '/tmp/auth.json' }],
      translate: (_text: string, ...args: unknown[]) =>
        args.length ? `${_text} ${args.join(' ')}` : _text,
      restartAfterImport: async () => undefined,
      onAuthChanged: async () => undefined,
      calls,
    },
    getActiveCodexAuthPath: () => '/tmp/auth.json',
    getLoginCommandText: () => 'codex login',
    createCodexTerminal: () => ({
      show: () => calls.push('terminal:show'),
      sendText: (text: string) => calls.push(`terminal:${text}`),
    }),
    runtimeHome: {},
    executeCommand: async (command: string) => {
      calls.push(`cmd:${command}`)
    },
    showInformationMessage: async (message: string, ...choices: string[]) => {
      calls.push(`prompt:${message}`)
      return responses.length > 0 ? responses.shift() : choices[0]
    },
    translate: (_text: string, ...args: unknown[]) =>
      args.length ? `${_text} ${args.join(' ')}` : _text,
    fsExistsSync: (filePath: string) => {
      if (filePath === '/tmp') {
        return true
      }
      if (filePath === '/tmp/auth.json') {
        return Boolean(overrides.authExists ?? false)
      }
      return Boolean(overrides.dirExists ?? false)
    },
    fsWatch: (
      _dir: string,
      _options: { persistent: boolean },
      callback: (event: string, filename?: string | Buffer) => void,
    ) => {
      watcherCallbacks.push(callback)
      calls.push('watch')
      return {
        close: () => calls.push('watch:close'),
      }
    },
    dirname: () => '/tmp',
    scheduleCleanup: (fn: () => void, ms: number) => {
      calls.push(`timeout:${ms}`)
      ;(deps as { scheduledCleanup?: () => void }).scheduledCleanup = fn
      return 0 as unknown as NodeJS.Timeout
    },
    calls,
    watcherCallbacks,
    scheduledCleanup: undefined as (() => void) | undefined,
  }

  return Object.assign(deps, overrides)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

test('loginViaCli stops when live auth replacement is rejected', async () => {
  const deps = makeDeps({
    promptDeps: {
      ...makeDeps().promptDeps,
      showWarningMessage: async () => undefined,
    },
  })

  await loginViaCli(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('loginViaCli opens the login terminal and imports now', async () => {
  const deps = makeDeps({
    responses: ['Import now'],
  })

  await loginViaCli(deps as any)
  assert.deepEqual(deps.calls, [
    'terminal:show',
    'terminal:codex login',
    'watch',
    'prompt:After completing the login flow, import the current environment auth.json from {0} as a profile. /tmp/auth.json',
    'watch:close',
    'cmd:codex-switch.profile.addFromCodexAuthFile',
  ])
})

test('loginViaCli opens manage profiles when requested', async () => {
  const deps = makeDeps({
    responses: ['Manage profiles'],
  })

  await loginViaCli(deps as any)
  assert.equal(deps.calls.includes('cmd:codex-switch.profile.manage'), true)
})

test('loginViaCli schedules cleanup when dismissed', async () => {
  const deps = makeDeps({
    responses: [undefined],
  })

  await loginViaCli(deps as any)
  assert.ok(
    (deps.calls as string[]).some((call) => call.startsWith('timeout:')),
  )
  ;(deps as { scheduledCleanup?: () => void }).scheduledCleanup?.()
})

test('loginViaCli imports from a detected auth.json', async () => {
  const deps = makeDeps({
    dirExists: true,
    authExists: true,
    responses: [undefined, 'Import'],
  })

  await loginViaCli(deps as any)
  for (const callback of deps.watcherCallbacks as Array<
    (event: string, filename?: string | Buffer) => Promise<void> | void
  >) {
    void callback('change', 'auth.json')
  }
  await flush()
  assert.ok(
    (deps.calls as string[]).includes(
      'cmd:codex-switch.profile.addFromCodexAuthFile',
    ),
  )
})

test('loginViaCli ignores watcher events without a filename', async () => {
  const deps = makeDeps({
    dirExists: true,
    authExists: true,
    responses: [undefined],
  })

  await loginViaCli(deps as any)
  for (const callback of deps.watcherCallbacks as Array<
    (event: string, filename?: string | Buffer) => Promise<void> | void
  >) {
    void callback('change')
  }
  await flush()
  assert.equal(
    (deps.calls as string[]).includes(
      'cmd:codex-switch.profile.addFromCodexAuthFile',
    ),
    false,
  )
})

test('loginViaCli ignores watcher events for non-auth files', async () => {
  const deps = makeDeps({
    dirExists: true,
    authExists: true,
    responses: [undefined],
  })

  await loginViaCli(deps as any)
  for (const callback of deps.watcherCallbacks as Array<
    (event: string, filename?: string | Buffer) => Promise<void> | void
  >) {
    void callback('change', 'notes.txt')
  }
  await flush()
  assert.equal(
    (deps.calls as string[]).includes(
      'cmd:codex-switch.profile.addFromCodexAuthFile',
    ),
    false,
  )
})

test('loginViaCli ignores watcher events after import', async () => {
  const deps = makeDeps({
    dirExists: true,
    authExists: true,
    responses: [undefined, 'Import'],
  })

  await loginViaCli(deps as any)
  const [callback] = deps.watcherCallbacks as Array<
    (event: string, filename?: string | Buffer) => Promise<void> | void
  >
  const callsBefore = deps.calls.length
  void callback('change', 'auth.json')
  await flush()
  void callback('change', 'auth.json')
  await flush()
  assert.equal(deps.calls.length > callsBefore, true)
  assert.equal(
    (deps.calls as string[]).filter(
      (call) => call === 'cmd:codex-switch.profile.addFromCodexAuthFile',
    ).length,
    1,
  )
})

test('loginViaCli stops watcher events after timeout', async () => {
  const originalNow = Date.now
  let nowCalls = 0
  Date.now = () => (nowCalls++ === 0 ? 0 : 10 * 60 * 1000 + 1)
  try {
    const deps = makeDeps({
      dirExists: true,
      authExists: true,
      responses: [undefined],
    })

    await loginViaCli(deps as any)
    for (const callback of deps.watcherCallbacks as Array<
      (event: string, filename?: string | Buffer) => Promise<void> | void
    >) {
      void callback('change', 'auth.json')
    }
    await flush()
    assert.ok((deps.calls as string[]).includes('watch:close'))
  } finally {
    Date.now = originalNow
  }
})

test('loginViaCli tolerates watcher close failures', async () => {
  const deps = makeDeps({
    dirExists: true,
    authExists: true,
    responses: ['Import now'],
    fsWatch: (
      _dir: string,
      _options: { persistent: boolean },
      callback: (event: string, filename?: string | Buffer) => void,
    ) => {
      deps.watcherCallbacks.push(callback)
      deps.calls.push('watch')
      return {
        close: () => {
          deps.calls.push('watch:close')
          throw new Error('close failed')
        },
      }
    },
  })

  await loginViaCli(deps as any)
  assert.ok((deps.calls as string[]).includes('watch:close'))
})

test('loginViaCli falls back when watcher setup fails', async () => {
  const deps = makeDeps({
    dirname: () => {
      throw new Error('dirname failed')
    },
    responses: ['Import now'],
  })

  await loginViaCli(deps as any)
  assert.ok((deps.calls as string[]).includes('terminal:codex login'))
})
