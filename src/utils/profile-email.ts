export function formatProfileEmailDescription(
  email: string | undefined,
): string | undefined {
  if (!email || email === 'Unknown') {
    return undefined
  }
  return email
}

export function formatProfileEmailLabel(
  email: string | undefined,
  unknownLabel: string,
): string {
  return formatProfileEmailDescription(email) ?? unknownLabel
}
