/**
 * Pure helpers for rendering maintenance/refresh timing beside profile usage.
 * The label is computed at render time from cached scheduling state, so no
 * per-second UI timer is required.
 */

export interface ProfileRefreshStatus {
  /** Timestamp (ms) of the last successful rate-limit result, if any. */
  lastSuccessAt?: number
  /** Timestamp (ms) when the next automatic refresh is due, if scheduled. */
  nextDueAt?: number
  /** Timestamp (ms) of the next retry after a failure, if a retry is pending. */
  nextRetryAt?: number
  /** True while a maintenance cycle is currently checking this profile. */
  isRefreshing: boolean
}

export type RefreshLabelTranslate = (
  message: string,
  ...args: Array<string | number>
) => string

export interface FormatProfileRefreshLabelOptions {
  now: number
  autoRefreshEnabled: boolean
  translate: RefreshLabelTranslate
}

/**
 * Compact, language-neutral relative duration: `30s`, `4m`, `2h`. Lower units
 * are floored so age reads at minute/hour granularity without a live timer.
 */
export function formatRelativeDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }

  const totalHours = Math.floor(totalMinutes / 60)
  return `${totalHours}h`
}

export function formatProfileRefreshLabel(
  status: ProfileRefreshStatus,
  options: FormatProfileRefreshLabelOptions,
): string {
  const { now, autoRefreshEnabled, translate } = options

  if (status.isRefreshing) {
    return translate('Updating now…')
  }

  const parts: string[] = []

  if (status.lastSuccessAt !== undefined) {
    parts.push(
      translate(
        'Updated {0} ago',
        formatRelativeDuration(now - status.lastSuccessAt),
      ),
    )
  }

  if (status.nextRetryAt !== undefined && status.nextRetryAt > now) {
    parts.push(
      translate(
        'Retry in {0}',
        formatRelativeDuration(status.nextRetryAt - now),
      ),
    )
  } else if (!autoRefreshEnabled) {
    parts.push(translate('Automatic refresh disabled'))
  } else if (status.nextDueAt !== undefined) {
    parts.push(
      translate(
        'Next refresh in {0}',
        formatRelativeDuration(Math.max(0, status.nextDueAt - now)),
      ),
    )
  }

  return parts.join(' · ')
}

export interface ProfileRefreshCells {
  /** Relative duration since last successful refresh (e.g. "3m"), '…' while refreshing, or '' if unknown. */
  updated: string
  /** Absolute HH:MM of next scheduled refresh/retry, or '' if auto-refresh is disabled or not scheduled. */
  next: string
}

function formatHHMM(timestampMs: number): string {
  const d = new Date(timestampMs)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/**
 * Returns absolute HH:MM timestamps for the Refresh tooltip cell.
 * Using absolute time avoids stale relative values when the popup stays open.
 */
export function formatProfileRefreshCells(
  status: ProfileRefreshStatus,
  options: Pick<FormatProfileRefreshLabelOptions, 'now' | 'autoRefreshEnabled'>,
): ProfileRefreshCells {
  const { now, autoRefreshEnabled } = options

  if (status.isRefreshing) {
    return { updated: '…', next: '' }
  }

  const updated =
    status.lastSuccessAt !== undefined
      ? formatRelativeDuration(now - status.lastSuccessAt)
      : ''

  let next = ''
  if (status.nextRetryAt !== undefined && status.nextRetryAt > now) {
    next = formatHHMM(status.nextRetryAt)
  } else if (autoRefreshEnabled && status.nextDueAt !== undefined) {
    next = formatHHMM(status.nextDueAt)
  }

  return { updated, next }
}
