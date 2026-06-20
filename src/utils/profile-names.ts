/** Builds a display name for a profile, falling back through name → email local part → fallback. */
export function buildDefaultProfileName(
  name: string | undefined,
  email: string | undefined,
  fallback: string,
): string {
  if (name && name.trim()) {
    return name.trim()
  }
  if (email && email !== 'Unknown') {
    const localPart = email.split('@')[0]?.trim()
    if (localPart) {
      return localPart
    }
  }
  return fallback
}
