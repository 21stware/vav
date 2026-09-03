import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isToggleDevtoolsChord,
  menuCommandDebounceMs,
  shouldSkipDuplicateMenuCommand
} from './menuInput.ts'

describe('menuCommandDebounceMs / shouldSkipDuplicateMenuCommand', () => {
  it('gives close-context a longer window than other commands', () => {
    assert.equal(menuCommandDebounceMs('close-context'), 400)
    assert.equal(menuCommandDebounceMs('new-conversation'), 80)
    assert.equal(shouldSkipDuplicateMenuCommand('send', 'send', 100, 50), true)
    assert.equal(shouldSkipDuplicateMenuCommand('send', 'send', 100, 10), false)
    assert.equal(shouldSkipDuplicateMenuCommand('send', 'find', 100, 90), false)
    assert.equal(shouldSkipDuplicateMenuCommand('close-context', 'close-context', 400, 1), true)
    assert.equal(shouldSkipDuplicateMenuCommand('close-context', 'close-context', 401, 1), false)
  })
})

describe('isToggleDevtoolsChord', () => {
  const down = {
    type: 'keyDown' as const,
    key: 'I',
    meta: false,
    alt: false,
    control: false,
    shift: false
  }

  it('matches Option-Command-I on macOS and Ctrl-Shift-I elsewhere', () => {
    assert.equal(
      isToggleDevtoolsChord({ ...down, meta: true, alt: true }, 'darwin'),
      true
    )
    assert.equal(
      isToggleDevtoolsChord({ ...down, control: true, shift: true }, 'linux'),
      true
    )
    assert.equal(
      isToggleDevtoolsChord({ ...down, control: true, shift: true }, 'win32'),
      true
    )
    assert.equal(isToggleDevtoolsChord({ ...down, meta: true, alt: true }, 'linux'), false)
    assert.equal(isToggleDevtoolsChord({ ...down, control: true, shift: true }, 'darwin'), false)
    assert.equal(isToggleDevtoolsChord({ ...down, type: 'keyUp', meta: true, alt: true }, 'darwin'), false)
    assert.equal(isToggleDevtoolsChord({ ...down, key: 'K', meta: true, alt: true }, 'darwin'), false)
  })
})
