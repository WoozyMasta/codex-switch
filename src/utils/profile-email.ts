/** Returns the email if defined and not 'Unknown', otherwise undefined. */
export function formatProfileEmailDescription(
  email: string | undefined,
): string | undefined {
  if (!email || email === 'Unknown') {
    return undefined
  }
  return email
}

/** Returns the email or a fallback label for unknown emails. */
export function formatProfileEmailLabel(
  email: string | undefined,
  unknownLabel: string,
): string {
  return formatProfileEmailDescription(email) ?? unknownLabel
}
