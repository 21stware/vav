import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { rememberHostGrid, resetHostGrid, spawnGrid } from './lastHostGrid.ts'

describe('spawnGrid', () => {
  beforeEach(() => resetHostGrid())

  it('uses the 80×24 stub when nothing has been measured', () => {
    assert.deepEqual(spawnGrid(80, 24), { cols: 80, rows: 24 })
  })

  it('replaces the stub with the last real viewer size', () => {
    rememberHostGrid(142, 48)
    assert.deepEqual(spawnGrid(80, 24), { cols: 142, rows: 48 })
  })

  it('honours an explicit non-stub size', () => {
    rememberHostGrid(142, 48)
    assert.deepEqual(spawnGrid(100, 30), { cols: 100, rows: 30 })
  })

  it('ignores tiny or incomplete measurements', () => {
    rememberHostGrid(10, 4)
    assert.deepEqual(spawnGrid(80, 24), { cols: 80, rows: 24 })
  })
})
