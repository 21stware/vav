import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostDisplayName } from './hostDisplay.ts'

describe('hostDisplayName', () => {
  it('uses the enabled-agent name, then the catalog fallback, then plain shell', () => {
    const fallback = (host: 'claude' | 'codex'): string => `fallback:${host}`
    assert.equal(hostDisplayName(null, [{ id: 'claude', name: 'Claude' }], 'Shell', fallback), 'Shell')
    assert.equal(
      hostDisplayName('claude', [{ id: 'claude', name: 'Claude Code' }], 'Shell', fallback),
      'Claude Code'
    )
    assert.equal(hostDisplayName('codex', [{ id: 'claude', name: 'Claude' }], 'Shell', fallback), 'fallback:codex')
  })
})
