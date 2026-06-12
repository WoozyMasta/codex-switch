import { createHash } from 'crypto'

export function sha256Text(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
