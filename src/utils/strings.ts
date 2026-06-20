/** Converts a value to a trimmed string, or undefined if not a string or if empty after trimming. */
export function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** Returns the first defined (non-empty) string from a list, or undefined if none exist. */
export function firstDefinedString(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (value) {
      return value
    }
  }
  return undefined
}
