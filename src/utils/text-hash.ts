import { createHash } from 'crypto'

/** Computes the SHA-256 hash of a string and returns it as a hexadecimal string. */
export function sha256Text(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
