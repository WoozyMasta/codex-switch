function rankLegacyProfileMigrationCandidate(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('codex-switch')) {
    return 0
  }
  if (lower.includes('codex-stats')) {
    return 1
  }
  return 2
}

export function sortLegacyProfileMigrationCandidates(
  candidates: string[],
): string[] {
  return [...candidates].sort(
    (a, b) =>
      rankLegacyProfileMigrationCandidate(a) -
      rankLegacyProfileMigrationCandidate(b),
  )
}
