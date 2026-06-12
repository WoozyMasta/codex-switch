export function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

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
