import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasClosableCliPanes, resolveContextCloseAction } from './closeContext.ts'

describe('hasClosableCliPanes', () => {
  it('closes a pane while more than one remains, or the last live agent', () => {
    assert.equal(hasClosableCliPanes(2, false), true)
    assert.equal(hasClosableCliPanes(2, true), true)
    assert.equal(hasClosableCliPanes(1, false), true)
  })

  it('does not capture ⌘W when only a picker is left', () => {
    assert.equal(hasClosableCliPanes(1, true), false)
    assert.equal(hasClosableCliPanes(0, false), false)
  })
})

describe('resolveContextCloseAction', () => {
  const base = {
    toolsCollapsed: true,
    cliMode: true,
    paneCount: 1,
    soleTabIsPending: false
  }

  it('closes a live agent only when the Swarm pane is focused', () => {
    assert.equal(resolveContextCloseAction({ ...base, focus: 'agent' }), 'agent')
  })

  it('closes the window when a single CLI Swarm is on screen but not focused', () => {
    assert.equal(resolveContextCloseAction({ ...base, focus: 'app' }), 'window')
    assert.equal(
      resolveContextCloseAction({ ...base, focus: 'app', paneCount: 2 }),
      'window'
    )
  })

  it('closes one conversation pane while several Thread/Swarm panes are visible', () => {
    assert.equal(
      resolveContextCloseAction({ ...base, cliMode: false, focus: 'app', swarmPaneCount: 2 }),
      'agent'
    )
    assert.equal(
      resolveContextCloseAction({ ...base, cliMode: false, focus: 'agent', swarmPaneCount: 3 }),
      'agent'
    )
  })

  it('closes the window on the last remaining conversation pane', () => {
    assert.equal(
      resolveContextCloseAction({ ...base, cliMode: false, focus: 'app', swarmPaneCount: 1 }),
      'window'
    )
  })

  it('never captures ⌘W on the last remaining picker — close the window', () => {
    const picker = { ...base, soleTabIsPending: true }
    assert.equal(resolveContextCloseAction({ ...picker, focus: 'agent' }), 'window')
    assert.equal(resolveContextCloseAction({ ...picker, focus: 'app' }), 'window')
  })

  it('still closes a picker pane when another pane remains and Swarm is focused', () => {
    assert.equal(
      resolveContextCloseAction({
        ...base,
        paneCount: 2,
        soleTabIsPending: true,
        focus: 'agent'
      }),
      'agent'
    )
  })

  it('leaves bash / files in charge when that tray is focused', () => {
    assert.equal(resolveContextCloseAction({ ...base, focus: 'bash' }), 'bash')
    assert.equal(
      resolveContextCloseAction({
        ...base,
        focus: 'files',
        toolsCollapsed: false
      }),
      'files'
    )
  })
})
