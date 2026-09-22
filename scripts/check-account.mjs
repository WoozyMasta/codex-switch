#!/usr/bin/env node
/**
 * Report one Codex account's rate limits, without touching the live home.
 *
 * Runs the same probe the extension's background refresh uses: `codex
 * app-server` over stdio, `initialize` then `account/rateLimits/read`. That
 * call reaches the account API, so unlike `codex login status`, which only
 * reads the file, it proves the credential is still accepted, and it exercises
 * a token refresh when the access token is near expiry. A credential
 * invalidated by `codex logout` fails here.
 *
 * Usage: node scripts/check-account.mjs [path/to/auth.json]
 *        defaults to $CODEX_HOME/auth.json, else ~/.codex/auth.json
 *
 * The auth file is copied into a private temp home (0700, file 0600) which is
 * removed afterwards, so the live file is never written and never rotated.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const source =
  process.argv[2] ??
  path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json')

// Not os.tmpdir(): Codex refuses to create its helper binaries under a temp
// dir and warns on every run.
const scratch = path.join(os.homedir(), '.cache')
fs.mkdirSync(scratch, { recursive: true })
const home = fs.mkdtempSync(path.join(scratch, 'codex-check-'))
fs.chmodSync(home, 0o700)
fs.copyFileSync(source, path.join(home, 'auth.json'))
fs.chmodSync(path.join(home, 'auth.json'), 0o600)

// Resolution order: CODEX_BIN, then the binary shipped with the VS Code
// ChatGPT extension, then PATH. The global npm install can be far older than
// the bundled one, and `account/rateLimits/read` does not exist before roughly
// 0.15x: on 0.46.0 it answers -32600 Invalid request, which reads like a
// broken credential when it is a stale CLI.
const bundled = () => {
  const root = path.join(os.homedir(), '.vscode-server', 'extensions')
  try {
    const dir = fs
      .readdirSync(root)
      .filter((name) => name.startsWith('openai.chatgpt-'))
      .sort()
      .pop()
    if (!dir) return null
    const candidate = path.join(root, dir, 'bin', 'linux-x86_64', 'codex')
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}
const codexBin = process.env.CODEX_BIN ?? bundled() ?? 'codex'
const child = spawn(codexBin, ['app-server'], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let id = 0
const pending = new Map()
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve, reject })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n',
    )
  })

readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const entry = pending.get(msg.id)
  if (!entry) return
  pending.delete(msg.id)
  msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result)
})

const cleanup = () => {
  try {
    child.kill()
  } catch {}
  fs.rmSync(home, { recursive: true, force: true })
}

const timer = setTimeout(() => {
  console.error('TIMEOUT: no answer from codex app-server in 60s')
  cleanup()
  process.exit(2)
}, 60_000)

try {
  // Minimal clientInfo only: older app-servers reject the extension's richer
  // shape with -32600.
  await send('initialize', {
    clientInfo: { name: 'codex-account-check', version: '1.0.0' },
  })
  const limits = await send('account/rateLimits/read')
  const r = limits?.rateLimits ?? {}
  const when = (s) => (s ? new Date(s * 1000).toLocaleString() : 'unknown')
  console.log(`OK   credential accepted  (plan: ${r.planType ?? 'unknown'})`)
  if (r.primary) {
    console.log(
      `  ${r.primary.windowDurationMins}min window: ${r.primary.usedPercent}% used, resets ${when(r.primary.resetsAt)}`,
    )
  }
  if (r.secondary) {
    console.log(
      `  ${r.secondary.windowDurationMins}min window: ${r.secondary.usedPercent}% used, resets ${when(r.secondary.resetsAt)}`,
    )
  }
} catch (err) {
  console.error('FAIL credential rejected:', err.message)
  clearTimeout(timer)
  cleanup()
  process.exit(1)
}
clearTimeout(timer)
cleanup()
