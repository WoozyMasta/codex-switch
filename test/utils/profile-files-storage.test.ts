/** Tests for profile-files-storage. */
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import type { ProfilesFileV1 } from '../../src/utils/profiles-file'
import {
  readProfilesFile,
  readProfilesFileState,
  requireWritableProfilesFile,
  writeProfilesFile,
} from '../../src/utils/profile-files-storage'

function makeDeps(filePath: string) {
  const readErrors: string[] = []
  const writeErrors: string[] = []
  let ensured = 0

  return {
    readErrors,
    writeErrors,
    ensured: () => ensured,
    deps: {
      ensureStorageDir: () => {
        ensured += 1
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
      },
      getProfilesPath: () => filePath,
      writeJsonFile: (file: string, data: ProfilesFileV1) => {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8')
      },
      showReadErrorMessage: (file: string) => {
        readErrors.push(file)
      },
      showWriteErrorMessage: (file: string) => {
        writeErrors.push(file)
      },
    },
  }
}

test('profile file storage helpers handle missing, valid, and corrupt files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-files-'))
  const filePath = path.join(dir, 'profiles.json')
  const { deps, readErrors, writeErrors, ensured } = makeDeps(filePath)

  assert.deepEqual(await readProfilesFileState(deps), {
    kind: 'missing',
    path: filePath,
  })
  assert.equal(ensured(), 1)

  fs.writeFileSync(
    filePath,
    JSON.stringify({ version: 1, profiles: [] }),
    'utf8',
  )
  assert.deepEqual(await readProfilesFileState(deps), {
    kind: 'valid',
    path: filePath,
    file: { version: 1, profiles: [] },
  })
  assert.deepEqual(await readProfilesFile(deps), {
    version: 1,
    profiles: [],
  })
  assert.deepEqual(readErrors, [])

  const missingRead = makeDeps(path.join(dir, 'missing-profiles.json'))
  assert.deepEqual(await readProfilesFile(missingRead.deps), {
    version: 1,
    profiles: [],
  })
  assert.deepEqual(missingRead.readErrors, [])

  fs.writeFileSync(filePath, 'not-json', 'utf8')
  assert.deepEqual(await readProfilesFileState(deps), {
    kind: 'corrupt',
    path: filePath,
    reason: 'Invalid profiles file format.',
  })

  assert.deepEqual(await readProfilesFile(deps), {
    version: 1,
    profiles: [],
  })
  assert.deepEqual(readErrors, [filePath])

  const injectedBoom = {
    ...deps,
    readFileSync: () => {
      throw 'boom'
    },
  }
  assert.deepEqual(await readProfilesFileState(injectedBoom), {
    kind: 'corrupt',
    path: filePath,
    reason: 'boom',
  })

  const injectedKaboom = {
    ...deps,
    readFileSync: () => {
      throw new Error('kaboom')
    },
  }
  assert.deepEqual(await readProfilesFileState(injectedKaboom), {
    kind: 'corrupt',
    path: filePath,
    reason: 'kaboom',
  })

  const writable = makeDeps(filePath)
  await writeProfilesFile(writable.deps, { version: 1, profiles: [] })
  assert.deepEqual(
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProfilesFileV1,
    { version: 1, profiles: [] },
  )

  fs.writeFileSync(
    filePath,
    JSON.stringify({ version: 1, profiles: [] }),
    'utf8',
  )
  assert.deepEqual(await requireWritableProfilesFile(writable.deps), {
    version: 1,
    profiles: [],
  })

  fs.writeFileSync(filePath, 'not-json', 'utf8')
  assert.equal(await requireWritableProfilesFile(writable.deps), null)
  assert.deepEqual(writable.writeErrors, [filePath])

  const missingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codex-switch-files-'),
  )
  const missingFilePath = path.join(missingDir, 'profiles.json')
  const missing = makeDeps(missingFilePath)
  assert.deepEqual(await requireWritableProfilesFile(missing.deps), {
    version: 1,
    profiles: [],
  })
  assert.deepEqual(missing.writeErrors, [])
})
