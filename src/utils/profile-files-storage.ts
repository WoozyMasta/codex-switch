import { existsSync, readFileSync } from 'fs'
import type { ProfilesFileV1 } from './profiles-file'
import {
  parseProfilesFileState,
  type ProfilesFileState as ParsedProfilesFileState,
} from './profiles-file-state'

export interface ProfileFilesStorageDeps {
  ensureStorageDir: () => void
  getProfilesPath: () => string
  existsSync?: (path: string) => boolean
  readFileSync?: (path: string, encoding: 'utf8') => string
}

export async function readProfilesFileState(
  deps: ProfileFilesStorageDeps,
): Promise<
  | ParsedProfilesFileState
  | {
      kind: 'missing'
      path: string
    }
> {
  deps.ensureStorageDir()
  const filePath = deps.getProfilesPath()
  const fileExists = deps.existsSync ?? existsSync
  const fileReadFileSync = deps.readFileSync ?? readFileSync
  if (!fileExists(filePath)) {
    return { kind: 'missing', path: filePath }
  }

  try {
    const raw = fileReadFileSync(filePath, 'utf8')
    return parseProfilesFileState(raw, filePath)
  } catch (error) {
    return {
      kind: 'corrupt',
      path: filePath,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function readProfilesFile(
  deps: ProfileFilesStorageDeps & {
    showReadErrorMessage: (path: string) => void
  },
): Promise<ProfilesFileV1> {
  const state = await readProfilesFileState(deps)
  if (state.kind === 'valid') {
    return state.file
  }
  if (state.kind === 'corrupt') {
    deps.showReadErrorMessage(state.path)
  }
  return { version: 1, profiles: [] }
}

export function writeProfilesFile(
  deps: {
    ensureStorageDir: () => void
    getProfilesPath: () => string
    writeJsonFile: (path: string, data: ProfilesFileV1) => void
  },
  data: ProfilesFileV1,
): void {
  deps.ensureStorageDir()
  deps.writeJsonFile(deps.getProfilesPath(), data)
}

export async function requireWritableProfilesFile(
  deps: ProfileFilesStorageDeps & {
    showWriteErrorMessage: (path: string) => void
  },
): Promise<ProfilesFileV1 | null> {
  const state = await readProfilesFileState(deps)
  if (state.kind === 'corrupt') {
    deps.showWriteErrorMessage(state.path)
    return null
  }

  return state.kind === 'valid' ? state.file : { version: 1, profiles: [] }
}
