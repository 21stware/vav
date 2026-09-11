import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isBareShiftEnter,
  isTerminalPasteChord,
  isTerminalProductModifier,
  KITTY_SHIFT_ENTER,
  shouldCopyInsteadOfInterrupt,
  TERMINAL_C0,
  terminalC0ForChord
} from './terminalKeys.ts'

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

describe('isTerminalProductModifier', () => {
  it('uses ⌘ on Mac and Ctrl elsewhere', () => {
    assert.equal(isTerminalProductModifier(key({ metaKey: true }), true), true)
    assert.equal(isTerminalProductModifier(key({ ctrlKey: true }), true), false)
    assert.equal(isTerminalProductModifier(key({ ctrlKey: true }), false), true)
    assert.equal(isTerminalProductModifier(key({ metaKey: true }), false), false)
  })
})

describe('terminalC0ForChord', () => {
  it('sends ETX for Ctrl+C so Kitty CSI-u cannot swallow interrupt', () => {
    assert.equal(terminalC0ForChord(key({ key: 'c', ctrlKey: true }), true), TERMINAL_C0.etx)
    assert.equal(terminalC0ForChord(key({ key: 'c', ctrlKey: true }), false), TERMINAL_C0.etx)
    assert.equal(terminalC0ForChord(key({ key: 'c', ctrlKey: true, metaKey: true }), true), null)
  })

  it('keeps Ctrl+D as EOF on Mac and leaves it to the split chord elsewhere', () => {
    assert.equal(terminalC0ForChord(key({ key: 'd', ctrlKey: true }), true), TERMINAL_C0.eot)
    assert.equal(terminalC0ForChord(key({ key: 'd', ctrlKey: true }), false), null)
  })

  it('maps Ctrl+Z and Ctrl+\\ to stop / quit', () => {
    assert.equal(terminalC0ForChord(key({ key: 'z', ctrlKey: true }), true), TERMINAL_C0.sub)
    assert.equal(terminalC0ForChord(key({ key: '\\', code: 'Backslash', ctrlKey: true }), true), TERMINAL_C0.fs)
  })

  it('copies a selection on Win/Linux Ctrl+C instead of interrupting', () => {
    const ev = key({ key: 'c', ctrlKey: true })
    assert.equal(shouldCopyInsteadOfInterrupt(ev, true, false), true)
    assert.equal(shouldCopyInsteadOfInterrupt(ev, false, false), false)
    assert.equal(shouldCopyInsteadOfInterrupt(ev, true, true), false)
  })
})
