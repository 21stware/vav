import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SYNC_HOLD_MAX_MS,
  SYNC_OUTPUT_DISABLE,
  SYNC_OUTPUT_ENABLE,
  lastUnclosedSyncEnableIndex,
  splitSynchronizedOutput,
  trailingIncompleteEscapeIndex
} from './terminalSyncFrames.ts'

describe('trailingIncompleteEscapeIndex', () => {
  it('returns -1 for complete text', () => {
    assert.equal(trailingIncompleteEscapeIndex('hello'), -1)
    assert.equal(trailingIncompleteEscapeIndex(`${SYNC_OUTPUT_ENABLE}ok${SYNC_OUTPUT_DISABLE}`), -1)
  })

  it('holds a CSI that has not seen its final byte', () => {
    assert.equal(trailingIncompleteEscapeIndex('pre\x1b[?2026'), 3)
    assert.equal(trailingIncompleteEscapeIndex('x\x1b['), 1)
    assert.equal(trailingIncompleteEscapeIndex('x\x1b'), 1)
  })

  it('holds an open OSC', () => {
    assert.equal(trailingIncompleteEscapeIndex('a\x1b]11;?'), 1)
  })
})

describe('lastUnclosedSyncEnableIndex', () => {
  it('is -1 when every enable has a matching disable', () => {
    const buf = `a${SYNC_OUTPUT_ENABLE}draw${SYNC_OUTPUT_DISABLE}b`
    assert.equal(lastUnclosedSyncEnableIndex(buf), -1)
  })

  it('points at the unmatched enable', () => {
    const buf = `pre${SYNC_OUTPUT_ENABLE}half`
    assert.equal(lastUnclosedSyncEnableIndex(buf), 3)
  })
})

describe('splitSynchronizedOutput', () => {
  it('emits a closed frame in full', () => {
    const buf = `pre${SYNC_OUTPUT_ENABLE}draw${SYNC_OUTPUT_DISABLE}post`
    assert.deepEqual(splitSynchronizedOutput(buf, 0), { emit: buf, hold: '' })
  })

  it('holds from 2026h until the frame closes', () => {
    const buf = `pre${SYNC_OUTPUT_ENABLE}half`
    assert.deepEqual(splitSynchronizedOutput(buf, 0), {
      emit: 'pre',
      hold: `${SYNC_OUTPUT_ENABLE}half`
    })
  })

  it('holds a trailing incomplete CSI so 2026h is not split across flushes', () => {
    const buf = `ok${SYNC_OUTPUT_DISABLE}\x1b[?2026`
    const split = splitSynchronizedOutput(buf, 0)
    assert.equal(split.emit, `ok${SYNC_OUTPUT_DISABLE}`)
    assert.equal(split.hold, '\x1b[?2026')
  })

  it('dumps the hold once the budget expires', () => {
    const buf = `${SYNC_OUTPUT_ENABLE}stuck`
    assert.deepEqual(splitSynchronizedOutput(buf, SYNC_HOLD_MAX_MS), { emit: buf, hold: '' })
  })
})
