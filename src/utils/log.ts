import * as vscode from 'vscode'

type DebugLoggingEnabledResolver = () => boolean

let debugLoggingEnabledResolver: DebugLoggingEnabledResolver | undefined

export function setDebugLoggingEnabledResolver(
  resolver: DebugLoggingEnabledResolver | undefined,
): void {
  debugLoggingEnabledResolver = resolver
}

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

export function debugLog(...args: unknown[]) {
  if (isDebugLoggingEnabled()) {
    // Never log secrets; keep debug logs high-level.
    console.log('[codex-switch]', ...args)
  }
}

export function warnLog(...args: unknown[]) {
  console.warn('[codex-switch]', ...args)
}

export function errorLog(...args: unknown[]) {
  console.error('[codex-switch]', ...args)
}
