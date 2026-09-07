import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateGridFromBox,
  isStubTerminalGrid,
  proposedCellsDiffer,
  scrollbackForSurface
} from './terminalFit.ts'

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

describe('isStubTerminalGrid', () => {
  it('recognizes the hardcoded spawn stub', () => {
    assert.equal(isStubTerminalGrid(80, 24), true)
    assert.equal(isStubTerminalGrid(81, 24), false)
    assert.equal(isStubTerminalGrid(80, 25), false)
  })
})

describe('estimateGridFromBox', () => {
  it('fills a typical agent panel at 12px', () => {
    const grid = estimateGridFromBox(860, 640, 12)
    assert.equal(grid.cols, 117)
    assert.equal(grid.rows, 46)
  })

  it('clamps tiny boxes so the TUI is still usable', () => {
    assert.deepEqual(estimateGridFromBox(10, 10, 13), { cols: 20, rows: 8 })
  })
})

describe('scrollbackForSurface', () => {
  it('keeps a history buffer only for bash', () => {
    assert.equal(scrollbackForSurface('bash'), 10_000)
    assert.equal(scrollbackForSurface('agent'), 0)
  })
})
