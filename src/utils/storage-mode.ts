import type { StorageMode } from '../types'

/** Resolves a StorageMode from 'auto' to a concrete implementation based on the VS Code remote name. */
export function resolveStorageMode(
  configured: StorageMode,
  remoteName: string | undefined,
): Exclude<StorageMode, 'auto'> {
  if (configured === 'auto') {
    return remoteName === 'ssh-remote' ? 'remoteFiles' : 'secretStorage'
  }
  return configured
}
