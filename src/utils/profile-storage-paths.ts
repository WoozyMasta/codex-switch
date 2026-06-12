import { homedir } from 'os'
import { join } from 'path'

export function resolveProfilesPath(
  isRemoteFilesMode: boolean,
  storageDir: string,
): string {
  if (isRemoteFilesMode) {
    return join(homedir(), '.codex-switch', 'profiles.json')
  }
  return join(storageDir, 'profiles.json')
}
