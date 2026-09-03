import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '../../../shared/types.ts'
import { emptyPtyLayouts } from './workspacePty.ts'
import { planHydratedPtySlice } from './workspaceHydrate.ts'

function tab(id: string, extra: Partial<TerminalTab> = {}): TerminalTab {
  return { id, title: id, isAgent: false, ...extra }
}

describe('planHydratedPtySlice', () => {
  it('skips a no-op when live tabs already match, else keeps the active bash tab', () => {
    const sh = tab('sh')
    const slice = {
      cliMode: false,
      activeHostAgentId: null as string | null,
      tabs: [sh],
      layout: { type: 'leaf' as const, tabId: 'sh', weight: 1 },
      agentHostSessions: {},
      activeTabId: 'sh'
    }
    const projected = {
      tabs: [sh],
      agentHostSessions: {}
    }
    assert.deepEqual(
      planHydratedPtySlice(slice, {
        followRemote: false,
        remoteLayouts: emptyPtyLayouts(),
        projected,
        status: { sh: 'running' }
      }),
      {}
    )
    const grown = planHydratedPtySlice(
      { ...slice, activeTabId: 'gone' },
      {
        followRemote: false,
        remoteLayouts: emptyPtyLayouts(),
        projected: { tabs: [sh, tab('sh-2')], agentHostSessions: {} },
        status: { sh: 'running', 'sh-2': 'running' }
      }
    )
    assert.equal(grown.activeTabId, 'sh')
    assert.deepEqual(
      grown.tabs?.map((t) => t.id),
      ['sh', 'sh-2']
    )
  })
})
