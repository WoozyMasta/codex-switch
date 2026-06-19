export function formatProfileEmailDescription(
  email: string | undefined,
): string | undefined {
  if (!email || email === 'Unknown') {
    return undefined
  }
  return email
}
