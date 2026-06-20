import type { ProfileRateLimits, ProfileRateLimitWindow } from '../types'

export const MAINTENANCE_STATE_SCHEMA_VERSION = 1

export type MaintenanceStatus = 'success' | 'failed' | 'canceled'

export const MAINTENANCE_ERROR_CATEGORIES = [
  'cli-not-found',
  'auth-missing',
  'auth-invalid',
  'process-failed',
  'request-timeout',
  'response-invalid',
  'storage-write-failed',
  'canceled',
  'unknown',
] as const

export type MaintenanceErrorCategory =
  (typeof MAINTENANCE_ERROR_CATEGORIES)[number]

/**
 * The persistent, per-profile coordination cache shared by every window.
 *
 * It contains only scheduling, status, and normalized usage. It must never
 * contain tokens, auth payloads, account identity, profile names, or paths.
 */
export interface MaintenanceProfileState {
  schemaVersion: number
  generation: number
  status: MaintenanceStatus
  lastAttemptAt: number
  lastSuccessAt: number | null
  nextDueAt: number | null
  nextRetryAt: number | null
  consecutiveFailures: number
  errorCategory?: MaintenanceErrorCategory
  rateLimits?: ProfileRateLimits
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asNullableTimestamp(value: unknown): number | null | undefined {
  if (value === null) {
    return null
  }
  return asFiniteNumber(value)
}

function parseRateLimitWindow(
  value: unknown,
): ProfileRateLimitWindow | null | undefined {
  if (value === null) {
    return null
  }
  const obj = asObject(value)
  if (!obj) {
    return undefined
  }
  const usedPercent = asFiniteNumber(obj.usedPercent)
  const remainingPercent = asFiniteNumber(obj.remainingPercent)
  if (usedPercent === undefined || remainingPercent === undefined) {
    return undefined
  }
  const resetsAt = asNullableTimestamp(obj.resetsAt)
  return {
    usedPercent,
    remainingPercent,
    resetsAt: resetsAt === undefined ? null : resetsAt,
  }
}

function parseRateLimits(value: unknown): ProfileRateLimits | undefined {
  const obj = asObject(value)
  if (!obj) {
    return undefined
  }
  const fiveHour = parseRateLimitWindow(obj.fiveHour)
  const weekly = parseRateLimitWindow(obj.weekly)
  if (fiveHour === undefined && weekly === undefined) {
    return undefined
  }
  return {
    fiveHour: fiveHour ?? null,
    weekly: weekly ?? null,
  }
}

function isMaintenanceStatus(value: unknown): value is MaintenanceStatus {
  return value === 'success' || value === 'failed' || value === 'canceled'
}

function isErrorCategory(value: unknown): value is MaintenanceErrorCategory {
  return (
    typeof value === 'string' &&
    (MAINTENANCE_ERROR_CATEGORIES as readonly string[]).includes(value)
  )
}

/**
 * Returns the raw schema version of a parsed JSON object, or undefined when it
 * is absent/malformed. Used to avoid overwriting an unsupported future schema
 * unless the current process owns the lease.
 */
export function readMaintenanceSchemaVersion(
  value: unknown,
): number | undefined {
  const obj = asObject(value)
  if (!obj) {
    return undefined
  }
  return asFiniteNumber(obj.schemaVersion)
}

/**
 * Strictly parse a stored profile state. Returns null for malformed input or
 * an unsupported schema version. Unknown extra fields are ignored.
 */
export function parseMaintenanceProfileState(
  value: unknown,
): MaintenanceProfileState | null {
  const obj = asObject(value)
  if (!obj) {
    return null
  }
  if (obj.schemaVersion !== MAINTENANCE_STATE_SCHEMA_VERSION) {
    return null
  }

  const generation = asFiniteNumber(obj.generation)
  const lastAttemptAt = asFiniteNumber(obj.lastAttemptAt)
  const consecutiveFailures = asFiniteNumber(obj.consecutiveFailures)
  if (
    generation === undefined ||
    lastAttemptAt === undefined ||
    consecutiveFailures === undefined ||
    !isMaintenanceStatus(obj.status)
  ) {
    return null
  }

  const lastSuccessAt = asNullableTimestamp(obj.lastSuccessAt)
  const nextDueAt = asNullableTimestamp(obj.nextDueAt)
  const nextRetryAt = asNullableTimestamp(obj.nextRetryAt)
  if (
    lastSuccessAt === undefined ||
    nextDueAt === undefined ||
    nextRetryAt === undefined
  ) {
    return null
  }

  const state: MaintenanceProfileState = {
    schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
    generation,
    status: obj.status,
    lastAttemptAt,
    lastSuccessAt,
    nextDueAt,
    nextRetryAt,
    consecutiveFailures,
  }

  if (isErrorCategory(obj.errorCategory)) {
    state.errorCategory = obj.errorCategory
  }

  const rateLimits = parseRateLimits(obj.rateLimits)
  if (rateLimits) {
    state.rateLimits = rateLimits
  }

  return state
}

/**
 * Serialize a state into a plain object containing only allowed fields. This is
 * the single writer, so secrets can never leak into coordination files.
 */
export function serializeMaintenanceProfileState(
  state: MaintenanceProfileState,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
    generation: state.generation,
    status: state.status,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    nextDueAt: state.nextDueAt,
    nextRetryAt: state.nextRetryAt,
    consecutiveFailures: state.consecutiveFailures,
  }
  if (state.errorCategory) {
    output.errorCategory = state.errorCategory
  }
  if (state.rateLimits) {
    output.rateLimits = state.rateLimits
  }
  return output
}
