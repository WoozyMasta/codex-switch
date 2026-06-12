export type ProfileStateScope = 'global' | 'workspace'

export function resolveProfileStateBucket<T>(
  scope: ProfileStateScope,
  globalBucket: T,
  workspaceBucket: T,
): T {
  return scope === 'workspace' ? workspaceBucket : globalBucket
}
