/** Tests for Codex CLI discovery. */
import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveCodexCliCommand } from '../../src/utils/codex-cli-resolver'

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'codex-switch-test-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function resolveFrom(directory: string) {
  return resolveCodexCliCommand({
    platform: 'win32',
    env: { PATH: directory },
  })
}

test('Windows discovery skips an extensionless POSIX shim and keeps searching the directory', () => {
  withTempDirectory((directory) => {
    writeFileSync(path.join(directory, 'codex'), '#!/bin/sh\n')
    writeFileSync(path.join(directory, 'codex.cmd'), '@echo off\n')

    assert.deepEqual(resolveFrom(directory), {
      command: 'cmd.exe',
      args: [
        '/d',
        '/v:off',
        '/c',
        path.join(directory, 'codex.cmd'),
        'app-server',
      ],
    })
  })
})

test('Windows discovery preserves non-shebang extensionless precedence', () => {
  withTempDirectory((directory) => {
    writeFileSync(path.join(directory, 'codex'), 'native-compatible\n')
    writeFileSync(path.join(directory, 'codex.exe'), 'MZ')

    assert.equal(resolveFrom(directory)?.command, path.join(directory, 'codex'))
  })
})

test('Windows discovery preserves directory precedence after skipping a shim', () => {
  withTempDirectory((root) => {
    const first = path.join(root, 'first')
    const second = path.join(root, 'second')
    mkdirSync(first)
    mkdirSync(second)
    writeFileSync(path.join(first, 'codex'), '#!/bin/sh\n')
    writeFileSync(path.join(first, 'codex.cmd'), '@echo off\n')
    writeFileSync(path.join(second, 'codex.exe'), 'MZ')

    const result = resolveCodexCliCommand({
      platform: 'win32',
      env: { PATH: [first, second].join(path.delimiter) },
    })
    assert.equal(result?.command, 'cmd.exe')
    assert.match(
      result?.args[result.args.length - 2] ?? '',
      /first[\\/]codex\.cmd$/,
    )
    assert.equal(result?.args[result.args.length - 1], 'app-server')
  })
})

test('Unix executable checks use the injected platform instead of the host platform', () => {
  withTempDirectory((directory) => {
    const candidate = path.join(directory, 'codex')
    writeFileSync(candidate, '#!/bin/sh\n')
    chmodSync(candidate, 0o755)

    const result = resolveCodexCliCommand({
      platform: 'linux',
      env: { PATH: directory },
    })
    assert.equal(result?.command, candidate)
  })
})
