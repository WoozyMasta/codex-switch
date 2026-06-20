import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAINTENANCE_STATE_SCHEMA_VERSION,
  parseMaintenanceProfileState,
  readMaintenanceSchemaVersion,
  serializeMaintenanceProfileState,
  type MaintenanceProfileState,
} from '../../src/utils/profile-maintenance-state'

function validState(): MaintenanceProfileState {
  return {
    schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
    generation: 42,
    status: 'success',
    lastAttemptAt: 1_781_900_000_000,
    lastSuccessAt: 1_781_900_006_000,
    nextDueAt: 1_781_900_906_000,
    nextRetryAt: null,
    consecutiveFailures: 0,
    rateLimits: {
      fiveHour: {
        usedPercent: 25,
        remainingPercent: 75,
        resetsAt: 1_781_910_000,
      },
      weekly: {
        usedPercent: 50,
        remainingPercent: 50,
        resetsAt: 1_782_400_000,
      },
    },
  }
}

test('parseMaintenanceProfileState accepts a full valid state', () => {
  const parsed = parseMaintenanceProfileState(validState())
  assert.deepEqual(parsed, validState())
})

test('parseMaintenanceProfileState accepts a minimal failure state', () => {
  const parsed = parseMaintenanceProfileState({
    schemaVersion: 1,
    generation: 1,
    status: 'failed',
    lastAttemptAt: 100,
    lastSuccessAt: null,
    nextDueAt: null,
    nextRetryAt: 200,
    consecutiveFailures: 3,
    errorCategory: 'request-timeout',
  })
  assert.equal(parsed?.status, 'failed')
  assert.equal(parsed?.errorCategory, 'request-timeout')
  assert.equal(parsed?.rateLimits, undefined)
})

test('parseMaintenanceProfileState rejects non-objects and wrong schema', () => {
  assert.equal(parseMaintenanceProfileState(null), null)
  assert.equal(parseMaintenanceProfileState(42), null)
  assert.equal(parseMaintenanceProfileState([1, 2]), null)
  assert.equal(parseMaintenanceProfileState({ schemaVersion: 2 }), null)
  assert.equal(parseMaintenanceProfileState({}), null)
})

test('parseMaintenanceProfileState rejects malformed required fields', () => {
  const base = validState() as unknown as Record<string, unknown>
  assert.equal(parseMaintenanceProfileState({ ...base, generation: 'x' }), null)
  assert.equal(
    parseMaintenanceProfileState({ ...base, lastAttemptAt: 'x' }),
    null,
  )
  assert.equal(
    parseMaintenanceProfileState({ ...base, consecutiveFailures: 'x' }),
    null,
  )
  assert.equal(parseMaintenanceProfileState({ ...base, status: 'nope' }), null)
  assert.equal(
    parseMaintenanceProfileState({ ...base, lastSuccessAt: 'x' }),
    null,
  )
  assert.equal(parseMaintenanceProfileState({ ...base, nextDueAt: 'x' }), null)
  assert.equal(
    parseMaintenanceProfileState({ ...base, nextRetryAt: 'x' }),
    null,
  )
})

test('parseMaintenanceProfileState ignores invalid error category and rate limits', () => {
  const base = validState() as unknown as Record<string, unknown>
  const parsed = parseMaintenanceProfileState({
    ...base,
    errorCategory: 'not-a-category',
    rateLimits: { fiveHour: {}, weekly: undefined },
  })
  assert.equal(parsed?.errorCategory, undefined)
  assert.equal(parsed?.rateLimits, undefined)
})

test('parseMaintenanceProfileState normalizes partial rate-limit windows', () => {
  const base = validState() as unknown as Record<string, unknown>
  const parsed = parseMaintenanceProfileState({
    ...base,
    rateLimits: {
      fiveHour: { usedPercent: 10, remainingPercent: 90 },
      weekly: null,
    },
  })
  assert.deepEqual(parsed?.rateLimits, {
    fiveHour: { usedPercent: 10, remainingPercent: 90, resetsAt: null },
    weekly: null,
  })

  const onlyWeekly = parseMaintenanceProfileState({
    ...base,
    rateLimits: {
      weekly: { usedPercent: 5, remainingPercent: 95, resetsAt: 123 },
    },
  })
  assert.deepEqual(onlyWeekly?.rateLimits, {
    fiveHour: null,
    weekly: { usedPercent: 5, remainingPercent: 95, resetsAt: 123 },
  })
})

test('readMaintenanceSchemaVersion extracts the version safely', () => {
  assert.equal(readMaintenanceSchemaVersion({ schemaVersion: 7 }), 7)
  assert.equal(readMaintenanceSchemaVersion({ schemaVersion: 'x' }), undefined)
  assert.equal(readMaintenanceSchemaVersion({}), undefined)
  assert.equal(readMaintenanceSchemaVersion(null), undefined)
})

test('serializeMaintenanceProfileState emits only allowed fields', () => {
  const serialized = serializeMaintenanceProfileState({
    ...validState(),
    errorCategory: 'unknown',
  })
  assert.deepEqual(Object.keys(serialized).sort(), [
    'consecutiveFailures',
    'errorCategory',
    'generation',
    'lastAttemptAt',
    'lastSuccessAt',
    'nextDueAt',
    'nextRetryAt',
    'rateLimits',
    'schemaVersion',
    'status',
  ])

  const minimal = serializeMaintenanceProfileState({
    schemaVersion: 1,
    generation: 1,
    status: 'canceled',
    lastAttemptAt: 1,
    lastSuccessAt: null,
    nextDueAt: null,
    nextRetryAt: null,
    consecutiveFailures: 0,
  })
  assert.equal('errorCategory' in minimal, false)
  assert.equal('rateLimits' in minimal, false)
})

test('serialize then parse round-trips a state', () => {
  const state = validState()
  const roundTripped = parseMaintenanceProfileState(
    JSON.parse(JSON.stringify(serializeMaintenanceProfileState(state))),
  )
  assert.deepEqual(roundTripped, state)
})
