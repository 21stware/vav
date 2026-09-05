import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NETWORK_RETRY_LIMIT } from './cliErrors.ts'
import {
  isLiveStreamPhase,
  isRecoveryPhase,
  parseHostTransportStatus,
  planHostRecoveryUi,
  planSameSessionRecovery,
  recoveryEqual,
  recoveryFromTransportEvent,
  recoveryRetryDelayMs,
  shouldRetryNativeTurn
} from './turnRecovery.ts'

describe('planSameSessionRecovery', () => {
  it('reconnects when the child died or the failure is a transport drop', () => {
    assert.equal(
      planSameSessionRecovery({ keepPartial: false, processDied: true, kind: 'network', attempt: 1 })
        .phase,
      'reconnecting'
    )
    assert.equal(
      planSameSessionRecovery({ keepPartial: false, kind: 'network', attempt: 2 }).phase,
      'reconnecting'
    )
    assert.equal(
      planSameSessionRecovery({ keepPartial: false, kind: 'technical', attempt: 1 }).phase,
      'retrying'
    )
  })

  it('heals a partial draft on the same turn', () => {
    const plan = planSameSessionRecovery({ keepPartial: true, kind: 'network', attempt: 1 })
    assert.equal(plan.phase, 'healing')
    assert.equal(plan.continueWithoutReprompt, true)
    assert.equal(plan.prepareReplayFromBlocks, true)
    assert.deepEqual(plan.recovery, { kind: 'healing', attempt: 1, limit: NETWORK_RETRY_LIMIT })
  })

  it('reconnects a dead process even when a partial draft exists', () => {
    const plan = planSameSessionRecovery({
      keepPartial: true,
      processDied: true,
      kind: 'network',
      attempt: 1
    })
    assert.equal(plan.phase, 'reconnecting')
    assert.equal(plan.continueWithoutReprompt, true)
  })
})

describe('recoveryRetryDelayMs', () => {
  it('uses a faster ladder for technical failures than for network', () => {
    assert.equal(recoveryRetryDelayMs('technical', 1), 400)
    assert.equal(recoveryRetryDelayMs('technical', 2), 1_000)
    assert.equal(recoveryRetryDelayMs('technical', 3), 2_500)
    assert.equal(recoveryRetryDelayMs('network', 1), 1_000)
    assert.equal(recoveryRetryDelayMs('network', 2), 2_500)
    assert.equal(recoveryRetryDelayMs('network', 3), 5_000)
  })

  it('clamps attempt 0 and overflow onto the last step', () => {
    assert.equal(recoveryRetryDelayMs('technical', 0), 400)
    assert.equal(recoveryRetryDelayMs('technical', 99), 2_500)
    assert.equal(recoveryRetryDelayMs('network', 0), 1_000)
    assert.equal(recoveryRetryDelayMs('network', 99), 5_000)
  })
})

describe('parseHostTransportStatus', () => {
  it('reads Codex retry / reconnect progress strings', () => {
    assert.deepEqual(parseHostTransportStatus('retrying sampling request (2/5)'), {
      kind: 'retrying',
      attempt: 2,
      limit: 5
    })
    assert.deepEqual(parseHostTransportStatus('Reconnecting 3/5'), {
      kind: 'reconnecting',
      attempt: 3,
      limit: 5
    })
    assert.equal(parseHostTransportStatus('healing session').kind, 'healing')
    assert.equal(parseHostTransportStatus('Recovering').kind, 'healing')
    assert.equal(parseHostTransportStatus('retrying').kind, 'retrying')
    assert.equal(parseHostTransportStatus('quota exceeded'), null)
    assert.equal(parseHostTransportStatus(''), null)
    assert.equal(parseHostTransportStatus('   '), null)
  })
})

describe('recoveryFromTransportEvent', () => {
  it('fills attempt from the live retry counter when the host omitted it', () => {
    assert.deepEqual(recoveryFromTransportEvent({ status: 'retrying' }, 0), {
      kind: 'retrying',
      attempt: 1,
      limit: NETWORK_RETRY_LIMIT
    })
    assert.deepEqual(
      recoveryFromTransportEvent({ status: 'reconnecting', attempt: 2, limit: 5 }, 0),
      { kind: 'reconnecting', attempt: 2, limit: 5 }
    )
  })
})

describe('planHostRecoveryUi', () => {
  it('uses host progress numbers on a technical retry with no draft', () => {
    const plan = planHostRecoveryUi({
      raw: 'retrying sampling request (2/5)',
      keepPartial: false,
      kind: 'technical',
      networkRetries: 0
    })
    assert.equal(plan.phase, 'retrying')
    assert.deepEqual(plan.recovery, { kind: 'retrying', attempt: 2, limit: 5 })
  })

  it('reconnects a dead socket and heals a partial draft', () => {
    assert.equal(
      planHostRecoveryUi({
        raw: 'ECONNRESET',
        keepPartial: false,
        kind: 'network',
        networkRetries: 0
      }).phase,
      'reconnecting'
    )
    const heal = planHostRecoveryUi({
      raw: 'TLS connection failed',
      keepPartial: true,
      kind: 'network',
      networkRetries: 0
    })
    assert.equal(heal.phase, 'healing')
    assert.equal(heal.continueWithoutReprompt, true)
  })
})

describe('shouldRetryNativeTurn', () => {
  it('retries network/technical stream deaths before any tool ran', () => {
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: false,
        error: 'ECONNRESET',
        toolCount: 0,
        attempts: 0
      }),
      true
    )
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: false,
        error: 'Error: RetriableError: WritableIterable is closed',
        toolCount: 0,
        attempts: 0
      }),
      true
    )
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: false,
        error: 'ECONNRESET',
        toolCount: 1,
        attempts: 0
      }),
      false
    )
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: false,
        error: 'ECONNRESET',
        toolCount: 0,
        attempts: NETWORK_RETRY_LIMIT
      }),
      false
    )
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: true,
        error: 'ECONNRESET',
        toolCount: 0,
        attempts: 0
      }),
      false
    )
    assert.equal(
      shouldRetryNativeTurn({
        cancelled: false,
        error: 'usage limit exceeded',
        toolCount: 0,
        attempts: 0
      }),
      false
    )
  })
})

describe('phase helpers', () => {
  it('treats recovery phases as live stream states', () => {
    assert.equal(isRecoveryPhase('reconnecting'), true)
    assert.equal(isRecoveryPhase('outputting'), false)
    assert.equal(isLiveStreamPhase('healing'), true)
    assert.equal(isLiveStreamPhase('awaiting-user'), false)
    assert.equal(recoveryEqual({ kind: 'retrying', attempt: 1, limit: 3 }, { kind: 'retrying', attempt: 1, limit: 3 }), true)
    assert.equal(recoveryEqual({ kind: 'retrying', attempt: 1, limit: 3 }, { kind: 'retrying', attempt: 2, limit: 3 }), false)
  })
})
