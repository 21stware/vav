import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBareShiftEnter, KITTY_SHIFT_ENTER } from './terminalKeys.ts'

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
