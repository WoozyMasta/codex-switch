import * as vscode from 'vscode'

type DebugLoggingEnabledResolver = () => boolean

let debugLoggingEnabledResolver: DebugLoggingEnabledResolver | undefined

/** Sets a custom resolver to determine if debug logging is enabled. */
export function setDebugLoggingEnabledResolver(
  resolver: DebugLoggingEnabledResolver | undefined,
): void {
  debugLoggingEnabledResolver = resolver
}

/** Checks whether debug logging is enabled via configuration. */
export function isDebugLoggingEnabled(): boolean {
  if (debugLoggingEnabledResolver) {
    return debugLoggingEnabledResolver()
  }

  const newCfg = vscode.workspace.getConfiguration('codexSwitch')
  if (newCfg.has('debugLogging')) {
    return !!newCfg.get<boolean>('debugLogging', false)
  }

  // Backward compatibility.
  return !!vscode.workspace
    .getConfiguration('codexUsage')
    .get<boolean>('debugLogging', false)
}

/** Logs a debug message if debug logging is enabled (prefixed with [codex-switch]). */
export function debugLog(...args: unknown[]) {
  if (isDebugLoggingEnabled()) {
    // Never log secrets; keep debug logs high-level.
    console.log('[codex-switch]', ...args)
  }
}

/** Logs a warning message to the console (prefixed with [codex-switch]). */
export function warnLog(...args: unknown[]) {
  console.warn('[codex-switch]', ...args)
}

/** Logs an error message to the console (prefixed with [codex-switch]). */
export function errorLog(...args: unknown[]) {
  console.error('[codex-switch]', ...args)
}
