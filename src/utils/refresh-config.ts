import * as vscode from 'vscode'
import {
  DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
  normalizeRateLimitAutoRefreshIntervalSeconds,
} from './refresh-options'

/**
 * Read and normalize the single user-facing refresh interval setting.
 * `0` disables automatic maintenance; positive values are clamped to the
 * supported `[30, 43200]` second range.
 */
export function getRateLimitAutoRefreshIntervalSeconds(): number {
  const value = vscode.workspace
    .getConfiguration('codexSwitch')
    .get<number>(
      'rateLimitAutoRefreshIntervalSeconds',
      DEFAULT_RATE_LIMIT_AUTO_REFRESH_INTERVAL_SECONDS,
    )
  return normalizeRateLimitAutoRefreshIntervalSeconds(value)
}
