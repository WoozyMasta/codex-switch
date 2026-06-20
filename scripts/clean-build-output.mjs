/** Cleans the compiled output directory (out/). */
import { rmSync } from 'node:fs'
import path from 'node:path'

rmSync(path.resolve('out'), {
  force: true,
  recursive: true,
})
