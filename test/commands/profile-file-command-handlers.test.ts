import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  addFromFile,
  exportProfiles,
  importProfiles,
} from '../../src/commands/profile-file-command-handlers'

function makePromptDeps(overrides: Record<string, unknown> = {}) {
  const calls = (overrides.calls as string[] | undefined) ?? []
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
    showWarningMessage: async () => undefined,
    showInputBox: async () => 'profile',
    showOpenDialog: async () => [{ fsPath: '/tmp/auth.json' }],
    translate: (_text: string, ...args: unknown[]) =>
      args.length ? `${_text} ${args.join(' ')}` : _text,
    restartAfterImport: async () => {
      calls.push('restart')
    },
    onAuthChanged: async () => {
      calls.push('auth')
    },
    calls,
  }

  return Object.assign(deps, overrides)
}

function makeFileDeps(overrides: Record<string, unknown> = {}) {
  const calls = (overrides.calls as string[] | undefined) ?? []
  const promptDeps = makePromptDeps({
    showWarningMessage: async () => 'Continue without saving',
    calls,
  })
  const deps = {
    promptDeps,
    getDefaultSettingsExportUri: () => ({ fsPath: '/tmp/export.json' }) as any,
    exportProfilesForTransfer: async () => ({
      data: { version: 1, profiles: [] },
      skipped: 0,
    }),
    importProfilesFromTransfer: async () => ({
      created: 1,
      updated: 2,
      skipped: 3,
    }),
    showOpenDialog: async () => [{ fsPath: '/tmp/input.json' }],
    showSaveDialog: async () => ({ fsPath: '/tmp/export.json' }) as any,
    showWarningMessage: async () => undefined,
    showErrorMessage: (message: string) => {
      calls.push(`error:${message}`)
    },
    showInformationMessage: (message: string) => {
      calls.push(`info:${message}`)
      return undefined
    },
    translate: (_text: string, ...args: unknown[]) =>
      args.length ? `${_text} ${args.join(' ')}` : _text,
    pathExists: () => false,
    readFileText: () => JSON.stringify({ version: 1 }),
    maybeRestartAfterProfileSwitch: async () => {
      calls.push('restart')
    },
    onAuthChanged: async () => {
      calls.push('auth')
    },
    calls,
  }

  return Object.assign(deps, overrides)
}

test('addFromFile stops when dialog is cancelled', async () => {
  const deps = makeFileDeps({
    showOpenDialog: async () => undefined,
  })

  await addFromFile(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('addFromFile reports invalid auth files', async () => {
  const deps = makeFileDeps({
    promptDeps: makePromptDeps({
      loadAuthDataFromFile: async () => null,
    }),
  })

  await addFromFile(deps as any)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('addFromFile imports a selected auth file', async () => {
  const deps = makeFileDeps()

  await addFromFile(deps as any)
  assert.deepEqual(deps.calls, ['auth', 'restart'])
})

test('addFromFile stops when live auth replacement is rejected', async () => {
  const deps = makeFileDeps({
    promptDeps: makePromptDeps({
      showWarningMessage: async () => undefined,
    }),
  })

  await addFromFile(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('exportProfiles writes the selected file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-'))
  try {
    const outputPath = path.join(tempDir, 'profiles.json')
    const deps = makeFileDeps({
      getDefaultSettingsExportUri: () => ({ fsPath: outputPath }) as any,
      showSaveDialog: async () => ({ fsPath: outputPath }) as any,
      showWarningMessage: async () => 'Export',
    })

    await exportProfiles(deps as any)

    assert.equal(fs.existsSync(outputPath), true)
    assert.match((deps.calls as string[])[0] ?? '', /^info:/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('exportProfiles stops when the export warning is dismissed', async () => {
  const deps = makeFileDeps({
    showWarningMessage: async () => undefined,
  })

  await exportProfiles(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('exportProfiles stops when the save dialog is cancelled', async () => {
  const deps = makeFileDeps({
    showSaveDialog: async () => undefined,
  })

  await exportProfiles(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('exportProfiles stops when overwrite is rejected', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-'))
  try {
    const outputPath = path.join(tempDir, 'profiles.json')
    fs.writeFileSync(outputPath, '{}')
    const deps = makeFileDeps({
      getDefaultSettingsExportUri: () => ({ fsPath: outputPath }) as any,
      showSaveDialog: async () => ({ fsPath: outputPath }) as any,
      pathExists: () => true,
      showWarningMessage: async (
        message: string,
        _opts: unknown,
        label: string,
      ) => (message.includes('already exists') ? undefined : label),
    })

    await exportProfiles(deps as any)
    assert.equal((deps.calls as string[]).length, 0)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('importProfiles stops when dialog is cancelled', async () => {
  const deps = makeFileDeps({
    showOpenDialog: async () => undefined,
  })

  await importProfiles(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})

test('importProfiles reports invalid JSON exports', async () => {
  const deps = makeFileDeps({
    readFileText: () => '{',
  })

  await importProfiles(deps as any)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('importProfiles imports and refreshes profiles', async () => {
  const deps = makeFileDeps()

  await importProfiles(deps as any)
  assert.deepEqual(deps.calls.slice(0, 2), ['auth', 'restart'])
  assert.match((deps.calls as string[])[2] ?? '', /^info:Import completed:/)
})

test('importProfiles reports import failures from error objects', async () => {
  const deps = makeFileDeps({
    importProfilesFromTransfer: async () => {
      throw new Error('boom')
    },
  })

  await importProfiles(deps as any)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('importProfiles reports import failures from unknown values', async () => {
  const deps = makeFileDeps({
    importProfilesFromTransfer: async () => {
      throw 'boom'
    },
  })

  await importProfiles(deps as any)
  assert.match((deps.calls as string[])[0] ?? '', /^error:/)
})

test('importProfiles stops when live auth replacement is rejected', async () => {
  const deps = makeFileDeps({
    promptDeps: makePromptDeps({
      showWarningMessage: async () => undefined,
    }),
  })

  await importProfiles(deps as any)
  assert.deepEqual((deps.calls as string[]).length, 0)
})
