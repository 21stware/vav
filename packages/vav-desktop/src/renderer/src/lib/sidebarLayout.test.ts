import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chromeLeadMode, shouldShowShellLeading } from './sidebarLayout.ts'

describe('chromeLeadMode', () => {
  it('lets the docked list own the traffic-light bay', () => {
    assert.equal(chromeLeadMode({ floating: false, sidebarVisible: true }), 'sidebar')
  })

  it('indents the next column when the list collapses to a rail', () => {
    assert.equal(chromeLeadMode({ floating: false, sidebarVisible: false }), 'rail')
  })

  it('indents flush content when the list floats or is gone', () => {
    assert.equal(chromeLeadMode({ floating: true, sidebarVisible: false }), 'flush')
    assert.equal(chromeLeadMode({ floating: true, sidebarVisible: true }), 'flush')
  })
})

describe('shouldShowShellLeading', () => {
  it('parks the toggle in the content header when the list is collapsed', () => {
    assert.equal(shouldShowShellLeading(false), true)
  })

  it('keeps the toggle in the docked list titlebar when the list is open', () => {
    assert.equal(shouldShowShellLeading(true), false)
  })
})
