import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCodexRateLimitWindowKinds,
  codexWindowMinutesFromRecord,
  mergeQuotaWindows,
  mergeQuotaWindowsPreferNewer,
  normalizeQuotaPercent,
  parseQuotaResetsAt,
  quotaKindFromClaudeType,
  quotaKindFromCodexWindow,
  windowsFromClaudeOAuthPayload,
  windowsFromCodexBackendPayload,
  windowsFromGrokBillingPayload
} from './quotaWindows.ts'

describe('normalizeQuotaPercent', () => {
  it('keeps host percents in 0–100 (does not treat ≤1 as a fraction)', () => {
    assert.equal(normalizeQuotaPercent(0), 0)
    assert.equal(normalizeQuotaPercent(0.8), 0.8)
    assert.equal(normalizeQuotaPercent(1), 1)
    assert.equal(normalizeQuotaPercent(1.0001), 1.0001)
    assert.equal(normalizeQuotaPercent(47.2), 47.2)
    assert.equal(normalizeQuotaPercent(100), 100)
  })

  it('clamps overshoot and rejects invalid values', () => {
    assert.equal(normalizeQuotaPercent(140), 100)
    assert.equal(normalizeQuotaPercent(-1), null)
    assert.equal(normalizeQuotaPercent(Number.NaN), null)
  })
})

describe('parseQuotaResetsAt', () => {
  it('treats unix seconds as seconds and large values as milliseconds', () => {
    assert.equal(parseQuotaResetsAt(1_700_000_000), 1_700_000_000_000)
    assert.equal(parseQuotaResetsAt(1_700_000_000_000), 1_700_000_000_000)
  })

  it('parses ISO strings', () => {
    assert.equal(parseQuotaResetsAt('2026-08-13T12:00:00.000Z'), Date.parse('2026-08-13T12:00:00.000Z'))
  })
})

describe('quotaKindFromClaudeType', () => {
  it('maps weekly and fable weekly aliases', () => {
    assert.equal(quotaKindFromClaudeType('seven_day'), 'seven_day')
    assert.equal(quotaKindFromClaudeType('weekly'), 'seven_day')
    assert.equal(quotaKindFromClaudeType('fable_weekly'), 'seven_day_opus')
    assert.equal(quotaKindFromClaudeType('fable-seven-day'), 'seven_day_opus')
    assert.equal(quotaKindFromClaudeType('seven_day_fable'), 'seven_day_opus')
    assert.equal(quotaKindFromClaudeType('five_hour'), 'five_hour')
  })
})

describe('quotaKindFromCodexWindow', () => {
  it('matches 5h / weekly buckets with a one-minute tolerance', () => {
    assert.equal(quotaKindFromCodexWindow('primary', 300), 'five_hour')
    assert.equal(quotaKindFromCodexWindow('secondary', 299), 'five_hour')
    assert.equal(quotaKindFromCodexWindow('primary', 10080), 'seven_day')
    assert.equal(quotaKindFromCodexWindow('secondary', 10081), 'seven_day')
  })

  it('falls back primary→5h and secondary→weekly when duration is unknown', () => {
    assert.equal(quotaKindFromCodexWindow('primary', null), 'five_hour')
    assert.equal(quotaKindFromCodexWindow('secondary', undefined), 'seven_day')
    assert.equal(quotaKindFromCodexWindow('other', 1440), 'other')
  })
})

describe('classifyCodexRateLimitWindowKinds', () => {
  it('classifies by duration even when keys are swapped', () => {
    const kinds = classifyCodexRateLimitWindowKinds({
      primary: { minutes: 10080 },
      secondary: { minutes: 300 }
    })
    assert.deepEqual(kinds, { primary: 'seven_day', secondary: 'five_hour' })
  })

  it('does not double-label weekly when primary already matched the weekly bucket', () => {
    const kinds = classifyCodexRateLimitWindowKinds({
      primary: { minutes: 10080 },
      secondary: { minutes: null }
    })
    assert.deepEqual(kinds, { primary: 'seven_day', secondary: null })
  })

  it('uses the legacy primary/secondary mapping when durations are missing', () => {
    const kinds = classifyCodexRateLimitWindowKinds({
      primary: { minutes: null },
      secondary: { minutes: null }
    })
    assert.deepEqual(kinds, { primary: 'five_hour', secondary: 'seven_day' })
  })
})

describe('codexWindowMinutesFromRecord', () => {
  it('reads app-server and backend field names', () => {
    assert.equal(codexWindowMinutesFromRecord({ windowDurationMins: 10080 }), 10080)
    assert.equal(codexWindowMinutesFromRecord({ window_minutes: 300 }), 300)
    assert.equal(codexWindowMinutesFromRecord({ limit_window_seconds: 18000 }), 300)
  })
})

describe('mergeQuotaWindows', () => {
  it('keeps a 1% weekly window as 1% across merges', () => {
    const merged = mergeQuotaWindows([], [
      {
        id: 'seven_day',
        kind: 'seven_day',
        usedPercent: 1,
        resetsAt: null,
        updatedAt: 1
      }
    ])
    assert.equal(merged[0]?.usedPercent, 1)
    const again = mergeQuotaWindows(merged, merged)
    assert.equal(again[0]?.usedPercent, 1)
  })
})

describe('windowsFromClaudeOAuthPayload', () => {
  it('maps five-hour, weekly, and fable scoped limits without scaling percents', () => {
    const windows = windowsFromClaudeOAuthPayload({
      five_hour: { utilization: 12.5, resets_at: '2026-08-13T12:00:00.000Z' },
      seven_day: { used_percentage: 1, resets_at: 1_700_000_000 },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 0.8,
          resets_at: 1_700_000_000,
          scope: { model: { display_name: 'Fable' } }
        }
      ]
    }, 100)
    assert.deepEqual(
      windows.map((w) => ({ id: w.id, kind: w.kind, usedPercent: w.usedPercent })),
      [
        { id: 'five_hour', kind: 'five_hour', usedPercent: 12.5 },
        { id: 'seven_day', kind: 'seven_day', usedPercent: 1 },
        { id: 'seven_day_opus', kind: 'seven_day_opus', usedPercent: 0.8 }
      ]
    )
  })
})

describe('windowsFromCodexBackendPayload', () => {
  it('classifies backend windows by duration', () => {
    const windows = windowsFromCodexBackendPayload({
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 10080 * 60, reset_at: 1_700_000_000 },
        secondary_window: { used_percent: 2.5, limit_window_seconds: 300 * 60, reset_at: 1_700_000_000 }
      }
    }, 100)
    assert.equal(windows[0]?.kind, 'five_hour')
    assert.equal(windows[0]?.usedPercent, 2.5)
    assert.equal(windows[1]?.kind, 'seven_day')
    assert.equal(windows[1]?.usedPercent, 40)
  })

  it('ignores payloads without plan_type', () => {
    assert.deepEqual(
      windowsFromCodexBackendPayload({
        rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } }
      }),
      []
    )
  })
})

describe('mergeQuotaWindowsPreferNewer', () => {
  it('keeps the newer account poll over a stale live sample', () => {
    const merged = mergeQuotaWindowsPreferNewer(
      [{ id: 'seven_day', kind: 'seven_day', usedPercent: 3, resetsAt: null, updatedAt: 20 }],
      [{ id: 'seven_day', kind: 'seven_day', usedPercent: 80, resetsAt: null, updatedAt: 10 }]
    )
    assert.equal(merged[0]?.usedPercent, 3)
  })
})

describe('windowsFromGrokBillingPayload', () => {
  it('maps weekly creditUsagePercent', () => {
    const windows = windowsFromGrokBillingPayload(
      {
        config: {
          creditUsagePercent: 42,
          currentPeriod: {
            type: 'USAGE_PERIOD_TYPE_WEEKLY',
            end: '2026-07-07T18:36:14.268512+00:00'
          }
        }
      },
      100
    )
    assert.equal(windows.length, 1)
    assert.equal(windows[0]?.kind, 'seven_day')
    assert.equal(windows[0]?.usedPercent, 42)
    assert.equal(windows[0]?.resetsAt, Date.parse('2026-07-07T18:36:14.268512+00:00'))
  })

  it('treats an omitted weekly percent as 0 when the period matches billing bounds', () => {
    const windows = windowsFromGrokBillingPayload({
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-07-17T19:38:56.948570+00:00',
          end: '2026-07-24T19:38:56.948570+00:00'
        },
        billingPeriodStart: '2026-07-17T19:38:56.948570+00:00',
        billingPeriodEnd: '2026-07-24T19:38:56.948570+00:00'
      }
    })
    assert.equal(windows[0]?.kind, 'seven_day')
    assert.equal(windows[0]?.usedPercent, 0)
  })

  it('maps monthly included budget', () => {
    const windows = windowsFromGrokBillingPayload({
      config: {
        monthlyLimit: { val: 150000 },
        used: { val: 837 },
        billingPeriodEnd: '2026-08-01T00:00:00+00:00'
      }
    })
    assert.equal(windows[0]?.kind, 'monthly')
    assert.ok(Math.abs((windows[0]?.usedPercent ?? 0) - (837 / 150000) * 100) < 1e-6)
  })
})
