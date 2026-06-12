import type { ProfilesFileV1 } from './profiles-file'
import { parseProfilesFile } from './profiles-file'

export interface ProfilesFileStateValid {
  kind: 'valid'
  path: string
  file: ProfilesFileV1
}

export interface ProfilesFileStateCorrupt {
  kind: 'corrupt'
  path: string
  reason: string
}

export type ProfilesFileState =
  | ProfilesFileStateValid
  | ProfilesFileStateCorrupt

export function parseProfilesFileState(
  raw: string,
  path: string,
): ProfilesFileState {
  const file = parseProfilesFile(raw)
  if (file) {
    return { kind: 'valid', path, file }
  }

  return {
    kind: 'corrupt',
    path,
    reason: 'Invalid profiles file format.',
  }
}
