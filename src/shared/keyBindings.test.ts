import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultAccelerator,
  matchingKeyBindingId,
  matchesAccelerator,
  prettyAccelerator,
  resolveKeyBindings,
  sanitizeKeyBindings
} from './keyBindings.ts'

describe('swarm pane bindings', () => {
  it('defaults split and spatial focus chords', () => {
    const bindings = resolveKeyBindings({})
    assert.equal(bindings.splitPaneRight, 'CmdOrCtrl+D')
    assert.equal(bindings.splitPaneDown, 'CmdOrCtrl+Shift+D')
    assert.equal(bindings.focusPaneLeft, 'CmdOrCtrl+Shift+Left')
    assert.equal(bindings.focusPaneRight, 'CmdOrCtrl+Shift+Right')
    assert.equal(bindings.focusPaneUp, 'CmdOrCtrl+Shift+Up')
    assert.equal(bindings.focusPaneDown, 'CmdOrCtrl+Shift+Down')
  })

  it('matches Cmd+Shift+ArrowLeft as focusPaneLeft', () => {
    const input = {
      type: 'keyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      control: false,
      alt: false,
      shift: true,
      meta: true
    }
    assert.equal(matchesAccelerator(input, 'CmdOrCtrl+Shift+Left', 'darwin'), true)
    assert.equal(matchesAccelerator(input, 'CmdOrCtrl+Left', 'darwin'), false)
    assert.equal(
      matchingKeyBindingId(
        {
          type: 'keydown',
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
          metaKey: true
        },
        resolveKeyBindings({}),
        'darwin',
        ['focusPaneLeft', 'focusPaneRight']
      ),
      'focusPaneLeft'
    )
  })

  it('pretty-prints arrow chords with glyphs on Mac', () => {
    assert.equal(prettyAccelerator('CmdOrCtrl+Shift+Left', 'darwin'), '⌘⇧←')
    assert.equal(prettyAccelerator('CmdOrCtrl+Shift+Right', 'darwin'), '⌘⇧→')
    assert.equal(prettyAccelerator('CmdOrCtrl+Shift+Left', 'win32'), 'Ctrl+Shift+Left')
  })

  it('keeps a rebound pane chord and drops unknown ids', () => {
    assert.deepEqual(
      sanitizeKeyBindings({
        focusPaneLeft: 'CmdOrCtrl+Alt+Left',
        nope: 'CmdOrCtrl+X'
      }),
      { focusPaneLeft: 'CmdOrCtrl+Alt+Left' }
    )
    assert.equal(defaultAccelerator('focusPaneLeft'), 'CmdOrCtrl+Shift+Left')
  })
})
