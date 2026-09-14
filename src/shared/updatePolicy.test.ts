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
  nativeStagingWaitDecision,
  nextUpdateFollowUp,
  parseSkippedUpdateVersion,
  resolveAutoUpdatePolicy,
  shouldSkipAutoFollowUp,
  shouldAutoCheck,
  shouldAutoDownload,
  shouldAutoInstall,
  shouldRunAutomaticCheck,
  shouldStartNativeMacStaging
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

  it('prefers the explicit policy over the legacy boolean', () => {
    assert.equal(
      resolveAutoUpdatePolicy({ autoUpdatePolicy: 'auto', autoCheckUpdates: false }),
      'auto'
    )
    assert.equal(
      resolveAutoUpdatePolicy({ autoUpdatePolicy: 'download', autoCheckUpdates: true }),
      'download'
    )
  })
})

describe('isAutoUpdatePolicy', () => {
  it('accepts the four stored values', () => {
    assert.equal(isAutoUpdatePolicy('off'), true)
    assert.equal(isAutoUpdatePolicy('notify'), true)
    assert.equal(isAutoUpdatePolicy('download'), true)
    assert.equal(isAutoUpdatePolicy('auto'), true)
    assert.equal(isAutoUpdatePolicy(true), false)
    assert.equal(isAutoUpdatePolicy(''), false)
  })
})

describe('policy gates', () => {
  it('off never auto-checks, downloads, or installs', () => {
    assert.equal(shouldAutoCheck('off'), false)
    assert.equal(shouldAutoDownload('off'), false)
    assert.equal(shouldAutoInstall('off'), false)
  })

  it('notify checks only', () => {
    assert.equal(shouldAutoCheck('notify'), true)
    assert.equal(shouldAutoDownload('notify'), false)
    assert.equal(shouldAutoInstall('notify'), false)
  })

  it('download checks and fetches, install stays manual', () => {
    assert.equal(shouldAutoCheck('download'), true)
    assert.equal(shouldAutoDownload('download'), true)
    assert.equal(shouldAutoInstall('download'), false)
  })

  it('auto does check, download, and install', () => {
    assert.equal(shouldAutoCheck('auto'), true)
    assert.equal(shouldAutoDownload('auto'), true)
    assert.equal(shouldAutoInstall('auto'), true)
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
    assert.equal(nextUpdateFollowUp('auto', 'available'), 'download')
  })

  it('installs only on auto once the package is ready', () => {
    assert.equal(nextUpdateFollowUp('download', 'ready'), 'none')
    assert.equal(nextUpdateFollowUp('auto', 'ready'), 'install')
    assert.equal(nextUpdateFollowUp('auto', 'latest'), 'none')
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

  it('allows cancel while downloading or unpacking', () => {
    assert.equal(canCancelUpdateDownload('downloading'), true)
    assert.equal(canCancelUpdateDownload('preparing'), true)
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

describe('parseSkippedUpdateVersion', () => {
  it('reads a persisted skip payload', () => {
    assert.equal(parseSkippedUpdateVersion({ skippedVersion: '1.29.0' }), '1.29.0')
    assert.equal(parseSkippedUpdateVersion({ skippedVersion: '  ' }), null)
    assert.equal(parseSkippedUpdateVersion({}), null)
    assert.equal(parseSkippedUpdateVersion(null), null)
  })
})

describe('shouldStartNativeMacStaging', () => {
  it('starts Squirrel for download/notify, not for auto (already started during download)', () => {
    assert.equal(
      shouldStartNativeMacStaging({
        nativeReady: false,
        autoInstallOnAppQuit: shouldAutoInstall('download')
      }),
      true
    )
    assert.equal(
      shouldStartNativeMacStaging({
        nativeReady: false,
        autoInstallOnAppQuit: shouldAutoInstall('notify')
      }),
      true
    )
    assert.equal(
      shouldStartNativeMacStaging({
        nativeReady: false,
        autoInstallOnAppQuit: shouldAutoInstall('auto')
      }),
      false
    )
    assert.equal(
      shouldStartNativeMacStaging({
        nativeReady: true,
        autoInstallOnAppQuit: shouldAutoInstall('download')
      }),
      false
    )
  })
})

describe('nativeStagingWaitDecision', () => {
  it('waits for the native event and only times out after the full window', () => {
    assert.equal(
      nativeStagingWaitDecision({
        nativeReady: true,
        elapsedMs: 60_000
      }),
      'ready'
    )
    assert.equal(
      nativeStagingWaitDecision({
        nativeReady: false,
        elapsedMs: 45_000
      }),
      'wait'
    )
    assert.equal(
      nativeStagingWaitDecision({
        nativeReady: false,
        elapsedMs: 5 * 60_000
      }),
      'wait'
    )
    assert.equal(
      nativeStagingWaitDecision({
        nativeReady: false,
        elapsedMs: 10 * 60_000
      }),
      'timeout'
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
