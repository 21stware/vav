import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatThinkingDuration, thinkingLabel } from './thinkingCopy.ts'

const t = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    key
  )
}

describe('formatThinkingDuration', () => {
  it('keeps seconds under a minute', () => {
    assert.equal(formatThinkingDuration(1_000, t), 'composer.durationSecond')
    assert.equal(formatThinkingDuration(5_000, t), 'composer.durationSeconds')
  })

  it('carries into minutes and hours', () => {
    assert.equal(formatThinkingDuration(60_000, t), 'composer.durationMinute')
    assert.equal(
      formatThinkingDuration(65_000, t),
      'composer.durationMinute composer.durationSeconds'
    )
    assert.equal(
      formatThinkingDuration(3_661_000, t),
      'composer.durationHour composer.durationMinute composer.durationSecond'
    )
  })
})

describe('thinkingLabel', () => {
  it('uses live vs settled copy', () => {
    assert.equal(thinkingLabel(5_000, true, t), 'composer.thinkingForLive')
    assert.equal(thinkingLabel(5_000, false, t), 'composer.thinkingFor')
    assert.equal(thinkingLabel(undefined, true, t), 'composer.thinking')
    assert.equal(thinkingLabel(undefined, false, t), 'composer.thinkingProcess')
  })
})
