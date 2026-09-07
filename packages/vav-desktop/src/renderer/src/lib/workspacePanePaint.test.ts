import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makePendingCliTab } from './cliPendingLayout.ts'
import { CLI_SURFACE_KEY } from './workspaceCliSurface.ts'
import { emptySlice } from './workspaceSlice.ts'
import { cliLiveTab } from './workspaceTabs.ts'
import {
  getCliSurface,
  paintedPrimaryAgentPane,
  patchedCliSurfaceTab,
  unpaintedPrimaryAgentPane
} from './workspacePanePaint.ts'

describe('workspacePanePaint', () => {
  it('swaps a pending picker leaf for a live PTY', () => {
    const pending = makePendingCliTab()
    const slice = emptySlice('/tmp/proj')
    slice.agentHostSessions[CLI_SURFACE_KEY] = {
      tabs: [pending],
      layout: { type: 'leaf', tabId: pending.id, weight: 1 },
      activeTabId: pending.id
    }
    const next = paintedPrimaryAgentPane(slice, 'claude', 'pty-1', 'Claude')
    assert.equal(next.cliMode, true)
    assert.equal(next.activeHostAgentId, CLI_SURFACE_KEY)
    const surface = next.agentHostSessions?.[CLI_SURFACE_KEY]
    assert.equal(surface?.activeTabId, 'pty-1')
    assert.equal(surface?.tabs[0]?.id, 'pty-1')
    assert.equal(surface?.tabs[0]?.pendingCli, false)
    assert.equal(next.agentHostSessions?.claude?.tabs[0]?.id, 'pty-1')
  })

  it('replaces a named surface tab', () => {
    const slice = emptySlice('/tmp/proj')
    const pending = makePendingCliTab()
    slice.agentHostSessions[CLI_SURFACE_KEY] = {
      tabs: [pending],
      layout: { type: 'leaf', tabId: pending.id, weight: 1 },
      activeTabId: pending.id
    }
    const live = cliLiveTab('pty-2', 'codex', 'Codex')
    const next = patchedCliSurfaceTab(slice, pending.id, live)
    assert.equal(getCliSurface({ ...slice, ...next })?.tabs[0]?.id, 'pty-2')
  })

  it('drops the surface when unpainting the only live pane', () => {
    const slice = emptySlice('/tmp/proj')
    const tab = cliLiveTab('pty-1', 'claude', 'Claude')
    slice.agentHostSessions = {
      [CLI_SURFACE_KEY]: {
        tabs: [tab],
        layout: { type: 'leaf', tabId: 'pty-1', weight: 1 },
        activeTabId: 'pty-1'
      },
      claude: {
        tabs: [tab],
        layout: { type: 'leaf', tabId: 'pty-1', weight: 1 },
        activeTabId: 'pty-1'
      }
    }
    const next = unpaintedPrimaryAgentPane(slice, 'claude', 'pty-1')
    assert.equal(next.activeHostAgentId, null)
    assert.equal(next.agentHostSessions?.[CLI_SURFACE_KEY], undefined)
    assert.equal(next.agentHostSessions?.claude, undefined)
  })
})
