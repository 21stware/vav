import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proposedCellsDiffer, scrollbackForSurface } from './terminalFit.ts'

describe('proposedCellsDiffer', () => {
  it('is false when FitAddon has no measurement yet', () => {
    assert.equal(proposedCellsDiffer(80, 24, null), false)
    assert.equal(proposedCellsDiffer(80, 24, undefined), false)
  })

  it('is false when the grid is unchanged', () => {
    assert.equal(proposedCellsDiffer(80, 24, { cols: 80, rows: 24 }), false)
  })

  it('is true when cols or rows changed', () => {
    assert.equal(proposedCellsDiffer(80, 24, { cols: 81, rows: 24 }), true)
    assert.equal(proposedCellsDiffer(80, 24, { cols: 80, rows: 23 }), true)
  })
})

describe('scrollbackForSurface', () => {
  it('keeps a history buffer only for bash', () => {
    assert.equal(scrollbackForSurface('bash'), 10_000)
    assert.equal(scrollbackForSurface('agent'), 0)
  })
})
