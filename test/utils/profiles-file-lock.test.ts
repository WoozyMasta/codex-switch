import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import { setTimeout as delay } from 'timers/promises'
import { withProfilesFileLock } from '../../src/utils/profiles-file-lock'

test('withProfilesFileLock serializes concurrent mutations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-lock-'))
  const profilesPath = path.join(dir, 'profiles.json')
  const order: string[] = []
  let releaseFirst!: () => void

  const first = withProfilesFileLock(profilesPath, async () => {
    order.push('first-start')
    await new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    order.push('first-end')
  })

  const second = withProfilesFileLock(profilesPath, async () => {
    order.push('second')
  })

  while (order.length === 0) {
    await delay(10)
  }

  await delay(150)
  assert.deepEqual(order, ['first-start'])

  releaseFirst()
  await first
  await second

  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  assert.equal(fs.existsSync(`${profilesPath}.lock`), false)
})

test('withProfilesFileLock clears stale lock files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-lock-'))
  const profilesPath = path.join(dir, 'profiles.json')
  const lockPath = `${profilesPath}.lock`

  fs.writeFileSync(lockPath, 'broken-lock', 'utf8')
  const staleTime = new Date('2000-01-01T00:00:00.000Z')
  fs.utimesSync(lockPath, staleTime, staleTime)

  let ran = false
  await withProfilesFileLock(profilesPath, async () => {
    ran = true
    assert.equal(fs.existsSync(lockPath), true)
  })

  assert.equal(ran, true)
  assert.equal(fs.existsSync(lockPath), false)
})

test('withProfilesFileLock propagates unexpected acquisition errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-lock-'))
  const profilesPath = path.join(dir, 'profiles.json')
  const originalWriteFileSync = fs.writeFileSync

  try {
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      throw 'boom'
    }) as typeof fs.writeFileSync

    await assert.rejects(
      withProfilesFileLock(profilesPath, async () => undefined),
      /boom/,
    )
  } finally {
    fs.writeFileSync = originalWriteFileSync
  }
})

test('withProfilesFileLock ignores cleanup failures after success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switch-lock-'))
  const profilesPath = path.join(dir, 'profiles.json')
  const lockPath = `${profilesPath}.lock`
  const originalUnlinkSync = fs.unlinkSync

  try {
    fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
      throw new Error('cleanup failed')
    }) as typeof fs.unlinkSync

    await withProfilesFileLock(profilesPath, async () => undefined)
    assert.equal(fs.existsSync(lockPath), true)
  } finally {
    fs.unlinkSync = originalUnlinkSync
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath)
    }
  }
})
