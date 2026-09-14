import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_AUTO_UPDATE_POLICY,
  UPDATE_FOCUS_COOLDOWN_MS,
  UPDATE_HEARTBEAT_MS,
  isAutoUpdatePolicy,
  isUpdateBusyPhase,
  isUpdateCancellationError,
  isUpdateSettledPhase,
  canCancelUpdateDownload,
  canRetryUpdateDownload,
  nextUpdateFollowUp,
  resolveAutoUpdatePolicy,
  shouldSkipAutoFollowUp,
  shouldAutoCheck,
  shouldAutoDownload,
  shouldRunAutomaticCheck
} from './updatePolicy.ts'

describe('resolveAutoUpdatePolicy', () => {
  it('defaults to notify', () => {
    assert.equal(resolveAutoUpdatePolicy({}), DEFAULT_AUTO_UPDATE_POLICY)
    assert.equal(resolveAutoUpdatePolicy({ autoCheckUpdates: true }), 'notify')
    assert.equal(resolveAutoUpdatePolicy({ autoUpdatePolicy: 'nope' }), 'notify')
  })

  it('maps legacy autoCheckUpdates false to off', () => {
    assert.equal(resolveAutoUpdatePolicy({ autoCheckUpdates: false }), 'off')
  })

  it('retires the legacy auto policy down to download', () => {
    assert.equal(resolveAutoUpdatePolicy({ autoUpdatePolicy: 'auto' }), 'download')
    assert.equal(
      resolveAutoUpdatePolicy({ autoUpdatePolicy: 'auto', autoCheckUpdates: false }),
      'download'
    )
  })

  it('prefers the explicit policy over the legacy boolean', () => {
    assert.equal(
      resolveAutoUpdatePolicy({ autoUpdatePolicy: 'download', autoCheckUpdates: true }),
      'download'
    )
  })
})

describe('isAutoUpdatePolicy', () => {
  it('accepts the three stored values and rejects retired auto', () => {
    assert.equal(isAutoUpdatePolicy('off'), true)
    assert.equal(isAutoUpdatePolicy('notify'), true)
    assert.equal(isAutoUpdatePolicy('download'), true)
    assert.equal(isAutoUpdatePolicy('auto'), false)
    assert.equal(isAutoUpdatePolicy(true), false)
    assert.equal(isAutoUpdatePolicy(''), false)
  })
})

describe('policy gates', () => {
  it('off never auto-checks or downloads', () => {
    assert.equal(shouldAutoCheck('off'), false)
    assert.equal(shouldAutoDownload('off'), false)
  })

  it('notify checks only', () => {
    assert.equal(shouldAutoCheck('notify'), true)
    assert.equal(shouldAutoDownload('notify'), false)
  })

  it('download checks and fetches, install stays manual', () => {
    assert.equal(shouldAutoCheck('download'), true)
    assert.equal(shouldAutoDownload('download'), true)
  })
})

describe('shouldRunAutomaticCheck', () => {
  const base = {
    policy: 'notify' as const,
    now: 10_000_000,
    lastCheckAt: 0,
    busy: false
  }

  it('never runs when off or busy', () => {
    assert.equal(shouldRunAutomaticCheck({ ...base, policy: 'off', reason: 'launch' }), false)
    assert.equal(shouldRunAutomaticCheck({ ...base, busy: true, reason: 'policy' }), false)
  })

  it('policy changes ignore cooldown; launch only if nothing has checked yet', () => {
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'launch',
        lastCheckAt: 0
      }),
      true
    )
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'launch',
        lastCheckAt: 1
      }),
      false
    )
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'policy',
        lastCheckAt: base.now
      }),
      true
    )
  })

  it('focus waits for the cooldown', () => {
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'focus',
        lastCheckAt: base.now - UPDATE_FOCUS_COOLDOWN_MS + 1
      }),
      false
    )
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'focus',
        lastCheckAt: base.now - UPDATE_FOCUS_COOLDOWN_MS
      }),
      true
    )
  })

  it('heartbeat waits for the interval', () => {
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'heartbeat',
        lastCheckAt: base.now - UPDATE_HEARTBEAT_MS + 1
      }),
      false
    )
    assert.equal(
      shouldRunAutomaticCheck({
        ...base,
        reason: 'heartbeat',
        lastCheckAt: base.now - UPDATE_HEARTBEAT_MS
      }),
      true
    )
  })
})

describe('nextUpdateFollowUp', () => {
  it('downloads when a newer build is available and the policy says so', () => {
    assert.equal(nextUpdateFollowUp('notify', 'available'), 'none')
    assert.equal(nextUpdateFollowUp('download', 'available'), 'download')
  })

  it('never auto-installs — ready always waits for an explicit Restart', () => {
    assert.equal(nextUpdateFollowUp('download', 'ready'), 'none')
    assert.equal(nextUpdateFollowUp('notify', 'ready'), 'none')
    assert.equal(nextUpdateFollowUp('download', 'latest'), 'none')
  })
})

describe('phase helpers', () => {
  it('treats check / transfer as busy and ready as settled', () => {
    assert.equal(isUpdateBusyPhase('checking'), true)
    assert.equal(isUpdateBusyPhase('downloading'), true)
    assert.equal(isUpdateBusyPhase('preparing'), true)
    assert.equal(isUpdateBusyPhase('available'), false)
    assert.equal(isUpdateSettledPhase('ready'), true)
    assert.equal(isUpdateSettledPhase('available'), false)
  })

  it('allows cancel only while downloading — staging during Restart is not cancellable', () => {
    assert.equal(canCancelUpdateDownload('downloading'), true)
    assert.equal(canCancelUpdateDownload('preparing'), false)
    assert.equal(canCancelUpdateDownload('available'), false)
    assert.equal(canCancelUpdateDownload('ready'), false)
  })

  it('allows retry after a failed transfer when a newer version is known', () => {
    assert.equal(canRetryUpdateDownload('error', '1.2.3'), true)
    assert.equal(canRetryUpdateDownload('error', null), false)
    assert.equal(canRetryUpdateDownload('preparing', '1.2.3'), false)
    assert.equal(canRetryUpdateDownload('available', '1.2.3'), false)
  })
})

describe('shouldSkipAutoFollowUp', () => {
  it('skips after an in-session cancel, or when this version already failed staging', () => {
    assert.equal(
      shouldSkipAutoFollowUp({
        sessionSkip: true,
        skippedVersion: null,
        latestVersion: '1.2.3'
      }),
      true
    )
    assert.equal(
      shouldSkipAutoFollowUp({
        sessionSkip: false,
        skippedVersion: '1.2.3',
        latestVersion: '1.2.3'
      }),
      true
    )
    assert.equal(
      shouldSkipAutoFollowUp({
        sessionSkip: false,
        skippedVersion: '1.2.3',
        latestVersion: '1.2.4'
      }),
      false
    )
    assert.equal(
      shouldSkipAutoFollowUp({
        sessionSkip: false,
        skippedVersion: null,
        latestVersion: '1.2.3'
      }),
      false
    )
  })
})

describe('isUpdateCancellationError', () => {
  it('recognizes electron-updater cancellation', () => {
    assert.equal(isUpdateCancellationError({ name: 'CancellationError', message: 'cancelled' }), true)
    assert.equal(isUpdateCancellationError(new Error('Download was canceled')), true)
    assert.equal(isUpdateCancellationError(new Error('network timeout')), false)
    assert.equal(isUpdateCancellationError(null), false)
  })
})
