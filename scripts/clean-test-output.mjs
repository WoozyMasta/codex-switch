import { rmSync } from 'node:fs'
import path from 'node:path'

rmSync(path.resolve('out-test'), {
  force: true,
  recursive: true,
})
