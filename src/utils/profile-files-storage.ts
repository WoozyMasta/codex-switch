import { existsSync, readFileSync } from 'fs'
import type { ProfilesFileV1 } from './profiles-file'
import {
  parseProfilesFileState,
  type ProfilesFileState as ParsedProfilesFileState,
} from './profiles-file-state'

/** Dependencies for reading/writing profiles file with file system abstraction. */
export interface ProfileFilesStorageDeps {
  /** Creates storage directory if it doesn't exist. */
  ensureStorageDir: () => void
  /** Returns the path to the profiles file. */
  getProfilesPath: () => string
  /** Optional file existence check (defaults to fs.existsSync). */
  existsSync?: (path: string) => boolean
  /** Optional file read function (defaults to fs.readFileSync). */
  readFileSync?: (path: string, encoding: 'utf8') => string
}

/** Reads profiles file state, returning valid, corrupt, or missing status. */
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

/** Reads profiles file, returning empty file if missing/corrupt and notifying user of errors. */
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

/** Writes profiles data to file, ensuring storage directory exists. */
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

/** Reads profiles file for writing, returning null if corrupt and notifying user, empty if missing. */
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
