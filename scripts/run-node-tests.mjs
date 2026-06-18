import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const outDir = path.resolve('out-test')
const testRoot = path.join(outDir, 'test')
const coverageEnabled = process.argv.includes('--coverage')

const testFiles = await collectTestFiles(testRoot)
if (testFiles.length === 0) {
  console.error(`No compiled test files found under ${testRoot}`)
  process.exit(1)
}

const args = ['--test']
if (coverageEnabled) {
  args.push(
    '--experimental-test-coverage',
    '--test-coverage-include=**/out-test/src/**/*.js',
    '--test-coverage-exclude=**/out-test/src/auth/codex-auth-sync.js',
    '--test-coverage-exclude=**/out-test/src/auth/auth-manager.js',
    '--test-coverage-exclude=**/out-test/src/auth/profile-rate-limit-service.js',
    '--test-coverage-exclude=**/out-test/src/auth/profile-state-service.js',
    '--test-coverage-exclude=**/out-test/src/codex-home/codex-home-manager.js',
    '--test-coverage-exclude=**/out-test/src/utils/log.js',
    '--test-coverage-lines=100',
    '--test-coverage-functions=100',
    '--test-coverage-branches=100',
  )
}
args.push(...testFiles)

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)

async function collectTestFiles(rootDir) {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const entryPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await collectTestFiles(entryPath)))
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        files.push(entryPath)
      }
    }
    return files.sort()
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}
