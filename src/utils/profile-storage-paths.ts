import { homedir } from 'os'
import { join } from 'path'

/** Resolves the path to profiles.json based on storage mode, using home directory for remote mode or storageDir otherwise. */
export function resolveProfilesPath(
  isRemoteFilesMode: boolean,
  storageDir: string,
): string {
  if (isRemoteFilesMode) {
    return join(homedir(), '.codex-switch', 'profiles.json')
  }
  return join(storageDir, 'profiles.json')
}
