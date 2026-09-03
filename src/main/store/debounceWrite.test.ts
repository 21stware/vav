import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDebouncedWriter } from './debounceWrite.ts'

describe('createDebouncedWriter', () => {
  it('coalesces scheduled writes and flush runs the last one', async () => {
    let n = 0
    const w = createDebouncedWriter(() => {
      n += 1
    }, 30)
    w.schedule()
    w.schedule()
    w.schedule()
    assert.equal(n, 0)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(n, 1)
    w.schedule()
    w.flush()
    assert.equal(n, 2)
    w.flush()
    assert.equal(n, 2)
  })

  it('cancel drops a pending write', async () => {
    let n = 0
    const w = createDebouncedWriter(() => {
      n += 1
    }, 20)
    w.schedule()
    w.cancel()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(n, 0)
  })
})
