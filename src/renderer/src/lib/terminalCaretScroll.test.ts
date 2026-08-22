import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldClampCaretScroll } from './terminalCaretScroll.ts'

describe('shouldClampCaretScroll', () => {
  const base = {
    hasScroll: true,
    focusedIsHelperTextarea: true,
    scrolledContainsHelper: true,
    scrolledIsHelperTextarea: false,
    insideXterm: false,
    insideTuiHost: false
  }

  it('clamps the helper textarea itself', () => {
    assert.equal(
      shouldClampCaretScroll({
        ...base,
        scrolledIsHelperTextarea: true,
        insideXterm: true
      }),
      true
    )
  })

  it('clamps TUI chrome inside .xterm (no app scrollback)', () => {
    assert.equal(
      shouldClampCaretScroll({
        ...base,
        insideXterm: true,
        insideTuiHost: true
      }),
      true
    )
  })

  it('leaves bash xterm viewport / scrollable-element alone', () => {
    assert.equal(
      shouldClampCaretScroll({
        ...base,
        insideXterm: true,
        insideTuiHost: false
      }),
      false
    )
  })

  it('clamps a shifted split-pane ancestor', () => {
    assert.equal(shouldClampCaretScroll(base), true)
  })

  it('ignores scroll when the helper textarea is not focused', () => {
    assert.equal(
      shouldClampCaretScroll({ ...base, focusedIsHelperTextarea: false }),
      false
    )
  })

  it('ignores an element that does not contain the helper', () => {
    assert.equal(
      shouldClampCaretScroll({ ...base, scrolledContainsHelper: false }),
      false
    )
  })

  it('ignores a zero scroll offset', () => {
    assert.equal(shouldClampCaretScroll({ ...base, hasScroll: false }), false)
  })
})
