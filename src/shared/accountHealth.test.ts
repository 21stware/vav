import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountHealthOf,
  isAccountRoutable,
  pickRoutableAccountId
} from './accountHealth.ts'

const NOW = 1_700_000_000_000

describe('accountHealthOf', () => {
  it('keeps missing quota unknown — never invents healthy', () => {
    const health = accountHealthOf(
      {
        kind: 'oauth',
        keyStatus: 'ok',
        oauthSignedIn: true,
        quotaWindows: [],
        quotaStatus: 'empty'
      },
      NOW
    )
    assert.equal(health.kind, 'unknown')
    assert.equal(health.source, 'quota')
  })

  it('treats an exhausted window with a future reset as resting', () => {
    const health = accountHealthOf(
      {
        kind: 'oauth',
        keyStatus: 'ok',
        oauthSignedIn: true,
        quotaWindows: [{ usedPercent: 100, resetsAt: NOW + 3_600_000, updatedAt: NOW }],
        quotaStatus: 'ready'
      },
      NOW
    )
    assert.equal(health.kind, 'resting')
    assert.equal(health.resetsAt, NOW + 3_600_000)
    assert.equal(isAccountRoutable(health.kind), false)
  })

  it('treats exhaustion without a future reset as capped', () => {
    const health = accountHealthOf(
      {
        kind: 'oauth',
        keyStatus: 'ok',
        oauthSignedIn: true,
        quotaWindows: [{ usedPercent: 99.6, resetsAt: null, updatedAt: NOW }],
        quotaStatus: 'ready'
      },
      NOW
    )
    assert.equal(health.kind, 'capped')
  })

  it('marks expired OAuth as needsReauth before looking at quota', () => {
    const health = accountHealthOf(
      {
        kind: 'oauth',
        keyStatus: 'unknown',
        oauthSignedIn: false,
        oauthExpired: true,
        quotaWindows: [{ usedPercent: 10, resetsAt: NOW + 1, updatedAt: NOW }],
        quotaStatus: 'ready'
      },
      NOW
    )
    assert.equal(health.kind, 'needsReauth')
    assert.equal(health.source, 'credential')
  })

  it('treats a valid API key without a quota API as ok', () => {
    const health = accountHealthOf(
      {
        kind: 'vav_key',
        keyStatus: 'ok',
        oauthSignedIn: false,
        quotaWindows: [],
        quotaStatus: 'none'
      },
      NOW
    )
    assert.equal(health.kind, 'ok')
    assert.equal(health.source, 'credential')
  })

  it('treats an empty prepaid wallet as capped', () => {
    const health = accountHealthOf(
      {
        kind: 'vav_key',
        keyStatus: 'ok',
        oauthSignedIn: false,
        quotaWindows: [],
        quotaStatus: 'none',
        balance: { available: false }
      },
      NOW
    )
    assert.equal(health.kind, 'capped')
    assert.equal(health.source, 'balance')
  })
})

describe('pickRoutableAccountId', () => {
  it('skips a resting current in favor of a healthy sibling', () => {
    assert.equal(
      pickRoutableAccountId([
        { id: 'a', current: true, healthKind: 'resting' },
        { id: 'b', current: false, healthKind: 'ok' }
      ]),
      'b'
    )
  })

  it('keeps current when it is still routable', () => {
    assert.equal(
      pickRoutableAccountId([
        { id: 'a', current: true, healthKind: 'ok' },
        { id: 'b', current: false, healthKind: 'ok' }
      ]),
      'a'
    )
  })

  it('falls back to current when every sibling is blocked', () => {
    assert.equal(
      pickRoutableAccountId([
        { id: 'a', current: true, healthKind: 'resting' },
        { id: 'b', current: false, healthKind: 'capped' }
      ]),
      'a'
    )
  })
})
