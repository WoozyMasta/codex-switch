import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import {
  deleteFileIfExists,
  ensureSharedStoreDirs,
  getSharedActiveProfilePath,
  getSharedActiveProfilePathForHome,
  getSharedActiveProfilesDir,
  getSharedProfileSecretsPath,
  getSharedProfilesDir,
  getSharedProfilesPath,
  getSharedStoreRoot,
  readJsonFile,
  writeJsonFile,
} from '../../src/auth/shared-profile-store'

async function withPlatform<T>(
  platform: NodeJS.Platform,
  run: () => T | Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) {
    throw new Error('process.platform descriptor is unavailable')
  }
  Object.defineProperty(process, 'platform', {
    ...descriptor,
    value: platform,
  })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

test('shared profile store path helpers and directory creation follow home dir', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-home-'))
  const originalHomedir = os.homedir
  const originalChmodSync = fs.chmodSync

  os.homedir = () => home
  fs.chmodSync = (() => {}) as typeof fs.chmodSync
  try {
    assert.equal(getSharedStoreRoot(), path.join(home, '.codex-switch'))
    assert.equal(
      getSharedProfilesDir(),
      path.join(home, '.codex-switch', 'profiles'),
    )
    assert.equal(
      getSharedActiveProfilesDir(),
      path.join(home, '.codex-switch', 'active-profiles'),
    )
    assert.equal(
      getSharedProfilesPath(),
      path.join(home, '.codex-switch', 'profiles.json'),
    )
    assert.equal(
      getSharedActiveProfilePath(),
      path.join(home, '.codex-switch', 'active-profile.json'),
    )
    assert.equal(
      getSharedActiveProfilePathForHome('home-1'),
      path.join(home, '.codex-switch', 'active-profiles', 'home-1.json'),
    )
    assert.equal(
      getSharedProfileSecretsPath('profile-1'),
      path.join(home, '.codex-switch', 'profiles', 'profile-1.json'),
    )

    await withPlatform('linux', async () => {
      ensureSharedStoreDirs()
    })

    assert.ok(fs.existsSync(path.join(home, '.codex-switch')))
    assert.ok(fs.existsSync(path.join(home, '.codex-switch', 'profiles')))
    assert.ok(
      fs.existsSync(path.join(home, '.codex-switch', 'active-profiles')),
    )
  } finally {
    os.homedir = originalHomedir
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store ignores permission correction failures when creating dirs', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-home-'))
  const originalHomedir = os.homedir
  const originalChmodSync = fs.chmodSync

  os.homedir = () => home
  fs.chmodSync = ((...args: Parameters<typeof fs.chmodSync>) => {
    void args
    throw new Error('chmod failed')
  }) as typeof fs.chmodSync
  try {
    await withPlatform('linux', async () => {
      ensureSharedStoreDirs()
    })

    assert.ok(fs.existsSync(path.join(home, '.codex-switch')))
    assert.ok(fs.existsSync(path.join(home, '.codex-switch', 'profiles')))
    assert.ok(
      fs.existsSync(path.join(home, '.codex-switch', 'active-profiles')),
    )
  } finally {
    os.homedir = originalHomedir
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store skips permission correction on windows', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-home-'))
  const originalHomedir = os.homedir
  const originalChmodSync = fs.chmodSync
  let chmodCalls = 0

  os.homedir = () => home
  fs.chmodSync = ((...args: Parameters<typeof fs.chmodSync>) => {
    void args
    chmodCalls += 1
  }) as typeof fs.chmodSync
  try {
    await withPlatform('win32', async () => {
      ensureSharedStoreDirs()
    })

    assert.equal(chmodCalls, 0)
    assert.ok(fs.existsSync(path.join(home, '.codex-switch')))
    assert.ok(fs.existsSync(path.join(home, '.codex-switch', 'profiles')))
    assert.ok(
      fs.existsSync(path.join(home, '.codex-switch', 'active-profiles')),
    )
  } finally {
    os.homedir = originalHomedir
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store reads json files and ignores corrupt content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')

  assert.equal(readJsonFile(filePath), null)

  fs.writeFileSync(filePath, JSON.stringify({ version: 1, profiles: [] }))
  assert.deepEqual(readJsonFile(filePath), { version: 1, profiles: [] })

  fs.writeFileSync(filePath, 'not-json', 'utf8')
  assert.equal(readJsonFile(filePath), null)
})

test('shared profile store writes atomically and removes temp files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalChmodSync = fs.chmodSync

  fs.chmodSync = (() => {}) as typeof fs.chmodSync
  try {
    await withPlatform('linux', async () => {
      writeJsonFile(filePath, { version: 1, profiles: [] })
    })

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      version: 1,
      profiles: [],
    })
    assert.deepEqual(fs.readdirSync(dir), ['profiles.json'])
  } finally {
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store ignores permission correction failures before writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalChmodSync = fs.chmodSync
  let chmodCalls = 0

  fs.chmodSync = ((...args: Parameters<typeof fs.chmodSync>) => {
    void args
    chmodCalls += 1
    if (chmodCalls === 1) {
      throw new Error('chmod failed')
    }
  }) as typeof fs.chmodSync
  try {
    await withPlatform('linux', async () => {
      writeJsonFile(filePath, { version: 1, profiles: [] })
    })

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      version: 1,
      profiles: [],
    })
    assert.deepEqual(fs.readdirSync(dir), ['profiles.json'])
  } finally {
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store ignores cleanup failures after writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalChmodSync = fs.chmodSync
  const originalExistsSync = fs.existsSync
  const originalUnlinkSync = fs.unlinkSync

  let chmodCalls = 0
  fs.chmodSync = ((...args: Parameters<typeof fs.chmodSync>) => {
    void args
    chmodCalls += 1
    if (chmodCalls === 2) {
      throw new Error('chmod failed')
    }
  }) as typeof fs.chmodSync
  fs.existsSync = ((filePath: string) => {
    return filePath.includes('.tmp.') ? true : originalExistsSync(filePath)
  }) as typeof fs.existsSync
  fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
    void args
    throw new Error('unlink failed')
  }) as typeof fs.unlinkSync
  try {
    await withPlatform('linux', async () => {
      writeJsonFile(filePath, { version: 1, profiles: [] })
    })

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      version: 1,
      profiles: [],
    })
    assert.deepEqual(fs.readdirSync(dir), ['profiles.json'])
  } finally {
    fs.chmodSync = originalChmodSync
    fs.existsSync = originalExistsSync
    fs.unlinkSync = originalUnlinkSync
  }
})

test('shared profile store falls back on windows rename failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalRenameSync = fs.renameSync

  fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
    void args
    throw new Error('rename failed')
  }) as typeof fs.renameSync
  try {
    await withPlatform('win32', async () => {
      writeJsonFile(filePath, { version: 1, profiles: [] })
    })

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      version: 1,
      profiles: [],
    })
    assert.deepEqual(fs.readdirSync(dir), ['profiles.json'])
  } finally {
    fs.renameSync = originalRenameSync
  }
})

test('shared profile store throws on non-win32 rename failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalRenameSync = fs.renameSync
  const originalChmodSync = fs.chmodSync

  fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
    void args
    throw new Error('rename failed')
  }) as typeof fs.renameSync
  fs.chmodSync = (() => {}) as typeof fs.chmodSync
  try {
    await withPlatform('linux', async () => {
      assert.throws(() => {
        writeJsonFile(filePath, { version: 1, profiles: [] })
      }, /rename failed/)
    })
  } finally {
    fs.renameSync = originalRenameSync
    fs.chmodSync = originalChmodSync
  }
})

test('shared profile store deletes files and ignores unlink failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-store-'))
  const filePath = path.join(dir, 'profiles.json')
  const originalExistsSync = fs.existsSync
  const originalUnlinkSync = fs.unlinkSync

  fs.writeFileSync(filePath, 'content', 'utf8')
  deleteFileIfExists(filePath)
  assert.equal(fs.existsSync(filePath), false)

  assert.doesNotThrow(() => deleteFileIfExists(path.join(dir, 'missing.json')))

  fs.existsSync = (() => true) as typeof fs.existsSync
  fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
    void args
    throw new Error('unlink failed')
  }) as typeof fs.unlinkSync
  try {
    assert.doesNotThrow(() =>
      deleteFileIfExists(path.join(dir, 'failing.json')),
    )
  } finally {
    fs.existsSync = originalExistsSync
    fs.unlinkSync = originalUnlinkSync
  }
})
