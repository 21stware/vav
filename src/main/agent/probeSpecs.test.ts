import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAgentBinaryCandidates, parseAgentProbeSpecs } from './probeSpecs.ts'

describe('parseAgentProbeSpecs', () => {
  it('keeps trimmed ids and string candidates, dropping junk rows', () => {
    assert.deepEqual(parseAgentProbeSpecs(null), [])
    assert.deepEqual(
      parseAgentProbeSpecs([
        { id: ' claude ', candidates: ['claude', '', 1, 'claude-code'] },
        { id: '', candidates: ['x'] },
        { candidates: ['x'] },
        'skip'
      ]),
      [{ id: 'claude', candidates: ['claude', 'claude-code'] }]
    )
  })
})

describe('parseAgentBinaryCandidates', () => {
  it('filters to non-empty strings', () => {
    assert.deepEqual(parseAgentBinaryCandidates(['a', '', 'b', 3]), ['a', 'b'])
    assert.deepEqual(parseAgentBinaryCandidates(null), [])
  })
})
