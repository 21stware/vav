import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_AUTO_UPDATE_POLICY,
  UPDATE_FOCUS_COOLDOWN_MS,
  UPDATE_HEARTBEAT_MS,
  isAutoUpdatePolicy,
  isUpdateBusyPhase,
  isUpdateSettledPhase,
  nextUpdateFollowUp,
  resolveAutoUpdatePolicy,
  shouldAutoCheck,
  shouldAutoDownload,
  shouldAutoInstall,
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
})
