import type { StorageMode } from '../types'

export function resolveStorageMode(
  configured: StorageMode,
  remoteName: string | undefined,
): Exclude<StorageMode, 'auto'> {
  if (configured === 'auto') {
    return remoteName === 'ssh-remote' ? 'remoteFiles' : 'secretStorage'
  }
  return configured
}
