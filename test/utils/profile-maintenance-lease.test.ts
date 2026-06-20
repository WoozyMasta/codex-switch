import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import * as realFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MaintenanceLease,
  type LeaseDiagnostics,
  type LeaseFileSystem,
  type LeaseProgress,
} from '../../src/utils/profile-maintenance-lease'

const diagnostics: LeaseDiagnostics = {
  pid: 1234,
  sessionId: 'session',
  appName: 'Visual Studio Code',
  uriScheme: 'vscode',
  ideVersion: '1.105.0',
  extensionVersion: '1.4.0',
}

const progress: LeaseProgress = {
  status: 'refreshing',
  profilesTotal: 4,
  profilesCompleted: 0,
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

class FakeLeaseFs implements LeaseFileSystem {
  readonly files = new Map<string, string>()
  onWrite?: (filePath: string, flag?: string) => void
  onRename?: (oldPath: string, newPath: string) => void
  onUnlink?: (filePath: string) => void

  async mkdir(): Promise<undefined> {
    return undefined
  }

  async writeFile(
    filePath: string,
    data: string,
    options: { flag?: string },
  ): Promise<void> {
    this.onWrite?.(filePath, options.flag)
    if (options.flag === 'wx' && this.files.has(filePath)) {
      throw errno('EEXIST')
    }
    this.files.set(filePath, data)
  }

  async readFile(filePath: string): Promise<string> {
    const value = this.files.get(filePath)
    if (value === undefined) {
      throw errno('ENOENT')
    }
    return value
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.onRename?.(oldPath, newPath)
    const value = this.files.get(oldPath)
    if (value === undefined) {
      throw errno('ENOENT')
    }
    this.files.set(newPath, value)
    this.files.delete(oldPath)
  }

  async unlink(filePath: string): Promise<void> {
    this.onUnlink?.(filePath)
    if (!this.files.has(filePath)) {
      throw errno('ENOENT')
    }
    this.files.delete(filePath)
  }
}

function makeClock(start = 1_000_000) {
  return { value: start }
}

let uuidCounter = 0

function makeLease(
  fs: LeaseFileSystem,
  clock: { value: number },
  leaseFile = '/scope/maintenance.lease',
) {
  return new MaintenanceLease(leaseFile, diagnostics, {
    fs,
    now: () => clock.value,
    uuid: () => `id-${uuidCounter++}`,
    staleMs: 60_000,
  })
}

test('only one concurrent caller acquires a fresh lease', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const a = makeLease(fs, clock)
  const b = makeLease(fs, clock)

  const ownerA = await a.tryAcquire(progress)
  const ownerB = await b.tryAcquire(progress)

  assert.ok(ownerA)
  assert.equal(ownerB, null)
})

test('heartbeat keeps a fresh lease and reports ownership', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const lease = makeLease(fs, clock)

  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)

  clock.value += 10_000
  assert.equal(
    await lease.heartbeat(owner, { ...progress, profilesCompleted: 2 }),
    true,
  )
  assert.equal(await lease.stillOwns(owner), true)

  // A second contender still cannot steal the refreshed lease.
  const other = makeLease(fs, clock)
  assert.equal(await other.tryAcquire(progress), null)
})

test('a stale lease is recovered by exactly one taker', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const original = makeLease(fs, clock)
  const ownerA = await original.tryAcquire(progress)
  assert.ok(ownerA)

  clock.value += 60_001

  const taker = makeLease(fs, clock)
  const ownerB = await taker.tryAcquire(progress)
  assert.ok(ownerB)
  assert.notEqual(ownerB.leaseId, ownerA.leaseId)

  // The resumed original owner fails the fencing check and cannot publish.
  assert.equal(await original.stillOwns(ownerA), false)
  assert.equal(await original.heartbeat(ownerA, progress), false)

  // A third window now sees a fresh lease.
  const third = makeLease(fs, clock)
  assert.equal(await third.tryAcquire(progress), null)
})

test('release removes only the owner-held lease', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const lease = makeLease(fs, clock)
  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)

  await lease.release(owner)
  assert.equal(fs.files.has('/scope/maintenance.lease'), false)

  // Recreate by another owner; the stale owner must not delete it.
  const other = makeLease(fs, clock)
  const ownerB = await other.tryAcquire(progress)
  assert.ok(ownerB)
  await lease.release(owner)
  assert.equal(fs.files.has('/scope/maintenance.lease'), true)
})

test('a malformed lease uses a conservative stale takeover', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.files.set('/scope/maintenance.lease', '{ not valid json')

  const lease = makeLease(fs, clock)
  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)
})

test('a lease missing required fields is treated as stale', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.files.set(
    '/scope/maintenance.lease',
    JSON.stringify({ leaseId: 'x', heartbeatAt: 'nope' }),
  )

  const lease = makeLease(fs, clock)
  assert.ok(await lease.tryAcquire(progress))
})

test('losing the takeover rename yields no ownership', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.files.set(
    '/scope/maintenance.lease',
    JSON.stringify({ leaseId: 'old', heartbeatAt: 0 }),
  )
  fs.onRename = () => {
    throw errno('ENOENT')
  }

  const lease = makeLease(fs, clock)
  assert.equal(await lease.tryAcquire(progress), null)
})

test('a recreated lease during takeover blocks the second creator', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.files.set(
    '/scope/maintenance.lease',
    JSON.stringify({ leaseId: 'old', heartbeatAt: 0 }),
  )
  // Simulate another process recreating the lease right before our exclusive
  // create during takeover (the moment the lease file is otherwise absent).
  fs.onWrite = (filePath, flag) => {
    if (flag === 'wx' && !fs.files.has(filePath)) {
      fs.files.set(filePath, JSON.stringify({ leaseId: 'new' }))
    }
  }

  const lease = makeLease(fs, clock)
  assert.equal(await lease.tryAcquire(progress), null)
})

test('unexpected create errors are propagated', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.onWrite = (_path, flag) => {
    if (flag === 'wx') {
      throw errno('EACCES')
    }
  }

  const lease = makeLease(fs, clock)
  await assert.rejects(() => lease.tryAcquire(progress), /EACCES/)
})

test('non-Error and non-object create failures are propagated', async () => {
  const stringThrower = new FakeLeaseFs()
  stringThrower.onWrite = (_path, flag) => {
    if (flag === 'wx') {
      throw 'boom'
    }
  }
  await assert.rejects(() =>
    makeLease(stringThrower, makeClock()).tryAcquire(progress),
  )

  const falsyThrower = new FakeLeaseFs()
  falsyThrower.onWrite = (_path, flag) => {
    if (flag === 'wx') {
      throw 0
    }
  }
  await assert.rejects(() =>
    makeLease(falsyThrower, makeClock()).tryAcquire(progress),
  )
})

test('non-object lease payloads are treated as stale', async () => {
  for (const payload of ['null', '5', '{"heartbeatAt":0}']) {
    const fs = new FakeLeaseFs()
    fs.files.set('/scope/maintenance.lease', payload)
    const lease = makeLease(fs, makeClock())
    assert.ok(await lease.tryAcquire(progress))
  }
})

test('heartbeat survives a failed atomic write and keeps ownership', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const lease = makeLease(fs, clock)
  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)

  fs.onRename = () => {
    throw errno('EPERM')
  }
  assert.equal(await lease.heartbeat(owner, progress), true)
})

test('release tolerates unlink failures', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const lease = makeLease(fs, clock)
  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)

  fs.onUnlink = () => {
    throw errno('EPERM')
  }
  await lease.release(owner)
})

test('a best-effort stale cleanup failure still yields ownership', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  fs.files.set(
    '/scope/maintenance.lease',
    JSON.stringify({ leaseId: 'old', heartbeatAt: 0 }),
  )
  fs.onUnlink = (filePath) => {
    if (filePath.includes('.stale.')) {
      throw errno('EPERM')
    }
  }

  const lease = makeLease(fs, clock)
  assert.ok(await lease.tryAcquire(progress))
})

test('lease applies default dependencies', async () => {
  const fs = new FakeLeaseFs()
  const lease = new MaintenanceLease('/scope/maintenance.lease', diagnostics, {
    fs,
    debugLog: () => undefined,
  })
  const owner = await lease.tryAcquire(progress)
  assert.ok(owner)
  assert.equal(await lease.stillOwns(owner), true)
})

test('non-Error failures in best-effort paths are tolerated', async () => {
  // Heartbeat write failure with a non-Error rejection.
  const heartbeatFs = new FakeLeaseFs()
  const heartbeatLease = makeLease(heartbeatFs, makeClock())
  const heartbeatOwner = await heartbeatLease.tryAcquire(progress)
  assert.ok(heartbeatOwner)
  heartbeatFs.onRename = () => {
    throw 'rename string failure'
  }
  assert.equal(await heartbeatLease.heartbeat(heartbeatOwner, progress), true)

  // Release unlink failure with a non-Error rejection.
  const releaseFs = new FakeLeaseFs()
  const releaseLease = makeLease(releaseFs, makeClock())
  const releaseOwner = await releaseLease.tryAcquire(progress)
  assert.ok(releaseOwner)
  releaseFs.onUnlink = () => {
    throw 'unlink string failure'
  }
  await releaseLease.release(releaseOwner)

  // Stale takeover rename lost with a non-Error rejection.
  const takeoverFs = new FakeLeaseFs()
  takeoverFs.files.set(
    '/scope/maintenance.lease',
    JSON.stringify({ leaseId: 'old', heartbeatAt: 0 }),
  )
  takeoverFs.onRename = () => {
    throw 'takeover string failure'
  }
  assert.equal(
    await makeLease(takeoverFs, makeClock()).tryAcquire(progress),
    null,
  )
})

test('ownership checks are false when the lease file is absent', async () => {
  const fs = new FakeLeaseFs()
  const clock = makeClock()
  const lease = makeLease(fs, clock)
  assert.equal(await lease.stillOwns({ leaseId: 'x', startedAt: 0 }), false)
  // release on an absent lease is a no-op and does not throw.
  await lease.release({ leaseId: 'x', startedAt: 0 })
})

test('lease works against a real temporary filesystem', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codex-switch-lease-'))
  const leaseFile = path.join(dir, 'maintenance.lease')
  const clock = makeClock()
  try {
    const a = new MaintenanceLease(leaseFile, diagnostics, {
      fs: realFs,
      now: () => clock.value,
      staleMs: 60_000,
    })
    const b = new MaintenanceLease(leaseFile, diagnostics, {
      fs: realFs,
      now: () => clock.value,
      staleMs: 60_000,
    })

    const owner = await a.tryAcquire(progress)
    assert.ok(owner)
    assert.equal(await b.tryAcquire(progress), null)

    clock.value += 60_001
    const takeover = await b.tryAcquire(progress)
    assert.ok(takeover)
    assert.equal(await a.stillOwns(owner), false)

    await b.release(takeover)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
