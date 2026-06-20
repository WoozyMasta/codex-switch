import type { ProfilesFileV1 } from './profiles-file'
import { parseProfilesFile } from './profiles-file'

/** Successfully parsed profiles file with valid structure. */
export interface ProfilesFileStateValid {
  /** Discriminator for valid state. */
  kind: 'valid'
  /** Path to the profiles file. */
  path: string
  /** Parsed profiles data. */
  file: ProfilesFileV1
}

/** Profiles file that failed to parse or has invalid structure. */
export interface ProfilesFileStateCorrupt {
  /** Discriminator for corrupt state. */
  kind: 'corrupt'
  /** Path to the profiles file. */
  path: string
  /** Description of the parsing error. */
  reason: string
}

/** Union type representing the result of parsing a profiles file. */
export type ProfilesFileState =
  | ProfilesFileStateValid
  | ProfilesFileStateCorrupt

/** Parses raw file content into a valid or corrupt state representation. */
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
