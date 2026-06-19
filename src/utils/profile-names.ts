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
