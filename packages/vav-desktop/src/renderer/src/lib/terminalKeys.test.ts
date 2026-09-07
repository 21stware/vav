import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBareShiftEnter, isTerminalPasteChord, KITTY_SHIFT_ENTER } from './terminalKeys.ts'

function key(partial: Partial<Parameters<typeof isBareShiftEnter>[0]>) {
  return {
    type: 'keydown',
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...partial
  }
}

describe('isTerminalPasteChord', () => {
  function pasteKey(partial: Partial<Parameters<typeof isTerminalPasteChord>[0]>) {
    return {
      type: 'keydown',
      key: 'v',
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      ...partial
    }
  }

  it('matches Cmd+V on Mac and Ctrl+V elsewhere', () => {
    assert.equal(isTerminalPasteChord(pasteKey({ metaKey: true }), true), true)
    assert.equal(isTerminalPasteChord(pasteKey({ ctrlKey: true }), false), true)
    assert.equal(isTerminalPasteChord(pasteKey({ ctrlKey: true, shiftKey: true }), false), true)
  })

  it('rejects the wrong modifier and leftover chords', () => {
    assert.equal(isTerminalPasteChord(pasteKey({ metaKey: true }), false), false)
    assert.equal(isTerminalPasteChord(pasteKey({ ctrlKey: true }), true), false)
    assert.equal(isTerminalPasteChord(pasteKey({ metaKey: true, altKey: true }), true), false)
    assert.equal(isTerminalPasteChord(pasteKey({ metaKey: true, key: 'c' }), true), false)
  })
})

describe('isBareShiftEnter', () => {
  it('matches Shift+Enter with no other modifiers', () => {
    assert.equal(isBareShiftEnter(key({ shiftKey: true })), true)
  })

  it('rejects plain Enter and modified chords', () => {
    assert.equal(isBareShiftEnter(key({})), false)
    assert.equal(isBareShiftEnter(key({ shiftKey: true, altKey: true })), false)
    assert.equal(isBareShiftEnter(key({ shiftKey: true, metaKey: true })), false)
    assert.equal(isBareShiftEnter(key({ shiftKey: true, ctrlKey: true })), false)
    assert.equal(isBareShiftEnter(key({ shiftKey: true, key: 'd' })), false)
    assert.equal(isBareShiftEnter(key({ type: 'keyup', shiftKey: true })), false)
  })

  it('exports the Kitty CSI-u sequence Claude / Codex expect', () => {
    assert.equal(KITTY_SHIFT_ENTER, '\x1b[13;2u')
  })
})
