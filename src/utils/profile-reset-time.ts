function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatProfileResetTime(
  resetsAt: number | null | undefined,
  now = new Date(),
): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) {
    return null
  }

  const resetDate = new Date(resetsAt * 1000)
  if (Number.isNaN(resetDate.getTime())) {
    return null
  }

  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(resetDate)

  if (isSameLocalDate(resetDate, now)) {
    return time
  }

  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
  }).format(resetDate)
  return `${day} ${time}`
}
