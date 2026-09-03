import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import { CLI_PENDING_PREFIX } from './cliPendingLayout.ts'
import { collectLeaves } from './workspaceLayout.ts'
import {
  CLI_SURFACE_KEY,
  hydratedActiveHostAgentId,
  mergeCliSurface,
  pendingCliPickerSurface,
  pickCliScreenFocusTab,
  planActivateAgentHostAfterSpawn,
  planCloseAgentTabPatch,
  planEnterCliMode,
  planFocusCliScreenPatch,
  planSplitAgentHost,
  planSplitCliSurface,
  preferredCliAssignTabId,
  resolveCloseAgentTabMeta,
  seedAgentHostSession,
  solePendingCliTabId,
  reconcileAgentHosts,
  type AgentHostSession
} from './workspaceCliSurface.ts'

function tab(partial: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    title: partial.title ?? 'CLI',
    isAgent: false,
    agentId: partial.agentId ?? null,
    pendingCli: partial.pendingCli ?? false,
    splitWeight: 1,
    ...partial
  }
}

function leaf(tabId: string): TerminalLayoutNode {
  return { type: 'leaf', tabId, weight: 1 }
}

describe('workspaceCliSurface', () => {
  it('maps a pending picker leaf onto a newly spawned PTY without adding a pane', () => {
    const pendingId = `${CLI_PENDING_PREFIX}chooser`
    const prev: AgentHostSession = {
      tabs: [tab({ id: pendingId, pendingCli: true })],
      layout: leaf(pendingId),
      activeTabId: pendingId
    }
    const live = tab({ id: 'pty-1', agentId: 'claude', title: 'claude' })
    const merged = mergeCliSurface(prev, { claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id } }, null)
    assert.ok(merged)
    assert.deepEqual(
      merged!.tabs.map((t) => t.id),
      ['pty-1']
    )
    assert.deepEqual(collectLeaves(merged!.layout), ['pty-1'])
    assert.equal(merged!.tabs[0]?.pendingCli, false)
    assert.equal(merged!.activeTabId, 'pty-1')
  })

  it('keeps the previous screen when projection is briefly empty', () => {
    const prev: AgentHostSession = {
      tabs: [tab({ id: 'pty-1', agentId: 'claude' })],
      layout: leaf('pty-1'),
      activeTabId: 'pty-1'
    }
    const merged = mergeCliSurface(prev, {}, null)
    assert.equal(merged?.tabs[0]?.id, 'pty-1')
    assert.deepEqual(collectLeaves(merged?.layout ?? null), ['pty-1'])
  })

  it('folds live hosts into the unified CLI surface key', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const out = reconcileAgentHosts(
      {},
      { claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id } }
    )
    assert.equal(Object.keys(out).includes(CLI_SURFACE_KEY), true)
    assert.equal(out[CLI_SURFACE_KEY]?.tabs[0]?.id, 'pty-1')
  })

  it('prefers a live pane of the focused agent, then any live pane', () => {
    const tabs = [
      tab({ id: 'pending', pendingCli: true, agentId: null }),
      tab({ id: 'claude', agentId: 'claude' }),
      tab({ id: 'cursor', agentId: 'cursor' })
    ]
    assert.equal(pickCliScreenFocusTab(tabs, 'cursor')?.id, 'cursor')
    assert.equal(pickCliScreenFocusTab(tabs, 'missing')?.id, 'claude')
    assert.equal(pickCliScreenFocusTab([tabs[0]!], 'cursor')?.id, 'pending')
    assert.equal(pickCliScreenFocusTab([], 'cursor'), undefined)
  })

  it('pins Screen mode onto an existing mixed surface without re-keying hosts', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const fallback: AgentHostSession = {
      tabs: [live],
      layout: leaf('pty-1'),
      activeTabId: 'pty-1'
    }
    const prev = {
      agentHostSessions: {
        [CLI_SURFACE_KEY]: { ...fallback, activeTabId: 'pty-1' },
        claude: fallback
      }
    }
    const next = planFocusCliScreenPatch(prev, fallback, 'pty-2')
    assert.equal(next.cliMode, true)
    assert.equal(next.activeHostAgentId, CLI_SURFACE_KEY)
    assert.equal(next.agentHostSessions[CLI_SURFACE_KEY]?.activeTabId, 'pty-2')
    assert.equal(next.agentHostSessions.claude, fallback)
    const missingSurface = planFocusCliScreenPatch({ agentHostSessions: {} }, fallback, 'pty-1')
    assert.equal(missingSurface.agentHostSessions[CLI_SURFACE_KEY]?.activeTabId, 'pty-1')
    assert.equal(missingSurface.agentHostSessions[CLI_SURFACE_KEY]?.tabs[0]?.id, 'pty-1')
  })

  it('plans enter-cli: noop, restore, promote, fold, and fresh picker', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const surface: AgentHostSession = {
      tabs: [live],
      layout: leaf('pty-1'),
      activeTabId: 'pty-1'
    }
    assert.equal(
      planEnterCliMode({
        cliMode: true,
        agentHostSessions: { [CLI_SURFACE_KEY]: surface }
      }).kind,
      'noop'
    )

    const restored = planEnterCliMode({
      cliMode: false,
      agentHostSessions: { [CLI_SURFACE_KEY]: { ...surface, layout: null } }
    })
    assert.equal(restored.kind, 'patch')
    if (restored.kind === 'patch') {
      assert.deepEqual(collectLeaves(restored.surface.layout), ['pty-1'])
      assert.equal(restored.autoAssignPendingId, undefined)
    }

    const promoted = planEnterCliMode({
      cliMode: false,
      agentHostSessions: {
        claude: { tabs: [live], layout: leaf('pty-1'), activeTabId: 'pty-1' }
      }
    })
    assert.equal(promoted.kind, 'patch')
    if (promoted.kind === 'patch') {
      assert.equal(promoted.surface.tabs[0]?.agentId, 'claude')
      assert.equal(promoted.surface.tabs[0]?.pendingCli, false)
    }

    const cursor = tab({ id: 'pty-2', agentId: 'cursor' })
    const folded = planEnterCliMode({
      cliMode: false,
      agentHostSessions: {
        claude: { tabs: [live], layout: leaf('pty-1'), activeTabId: 'pty-1' },
        cursor: { tabs: [cursor], layout: leaf('pty-2'), activeTabId: 'pty-2' }
      }
    })
    assert.equal(folded.kind, 'patch')
    if (folded.kind === 'patch') {
      assert.deepEqual(
        folded.surface.tabs.map((t) => t.id),
        ['pty-1', 'pty-2']
      )
      assert.deepEqual(collectLeaves(folded.surface.layout), ['pty-1', 'pty-2'])
    }

    const fresh = planEnterCliMode(
      { cliMode: false, agentHostSessions: {} },
      { makePendingTab: () => tab({ id: 'cli-pending:test', pendingCli: true, agentId: null }) }
    )
    assert.equal(fresh.kind, 'patch')
    if (fresh.kind === 'patch') {
      assert.equal(fresh.autoAssignPendingId, 'cli-pending:test')
      assert.equal(fresh.surface.activeTabId, 'cli-pending:test')
    }
  })

  it('plans a CLI split onto a new picker, or seeds a lone leaf', () => {
    const pending = tab({ id: 'cli-pending:split', pendingCli: true, agentId: null })
    assert.equal(planSplitCliSurface(undefined, 'row', pending), null)
    const seeded = planSplitCliSurface(
      { tabs: [], layout: null, activeTabId: '' },
      'row',
      pending
    )
    assert.equal(seeded?.kind, 'seed')
    if (seeded?.kind === 'seed') {
      assert.equal(seeded.surface.activeTabId, pending.id)
    }
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const split = planSplitCliSurface(
      { tabs: [live], layout: leaf('pty-1'), activeTabId: 'pty-1' },
      'column',
      pending
    )
    assert.equal(split?.kind, 'split')
    if (split?.kind === 'split') {
      assert.deepEqual(collectLeaves(split.layout), ['pty-1', pending.id])
    }
  })

  it('keeps the stable primary id only for the first live pane of that agent', () => {
    const pending = tab({ id: 'cli-pending:a', pendingCli: true, agentId: null })
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    assert.equal(
      preferredCliAssignTabId({
        surface: { tabs: [pending] },
        tabId: pending.id,
        agentId: 'claude',
        primaryId: 'primary-claude'
      }),
      'primary-claude'
    )
    assert.equal(
      preferredCliAssignTabId({
        surface: { tabs: [live, pending] },
        tabId: pending.id,
        agentId: 'claude',
        primaryId: 'primary-claude'
      }),
      undefined
    )
    assert.equal(
      preferredCliAssignTabId({
        surface: { tabs: [pending] },
        tabId: pending.id,
        agentId: 'claude',
        resume: true,
        primaryId: 'primary-claude'
      }),
      undefined
    )
  })

  it('resumes into a lone pending picker and ignores mixed surfaces', () => {
    assert.equal(
      solePendingCliTabId({ tabs: [tab({ id: 'cli-pending:a', pendingCli: true, agentId: null })] }),
      'cli-pending:a'
    )
    assert.equal(
      solePendingCliTabId({
        tabs: [
          tab({ id: 'cli-pending:a', pendingCli: true, agentId: null }),
          tab({ id: 'pty-1', agentId: 'claude' })
        ]
      }),
      null
    )
    assert.equal(solePendingCliTabId({ tabs: [tab({ id: 'pty-1', agentId: 'claude' })] }), null)
  })

  it('seeds a Screen-filling pending picker without auto-assign', () => {
    const pending = tab({ id: 'cli-pending:a', pendingCli: true, agentId: null })
    assert.deepEqual(pendingCliPickerSurface(pending), {
      tabs: [pending],
      layout: leaf(pending.id),
      activeTabId: pending.id
    })
  })

  it('finds a pane on the Screen or the active per-agent host', () => {
    const pending = tab({ id: 'cli-pending:a', pendingCli: true, agentId: null })
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    assert.equal(
      resolveCloseAgentTabMeta(
        {
          activeHostAgentId: CLI_SURFACE_KEY,
          agentHostSessions: {
            [CLI_SURFACE_KEY]: { tabs: [pending], layout: leaf(pending.id), activeTabId: pending.id }
          }
        },
        pending.id
      )?.pendingCli,
      true
    )
    assert.equal(
      resolveCloseAgentTabMeta(
        {
          activeHostAgentId: 'claude',
          agentHostSessions: {
            claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id }
          }
        },
        live.id
      )?.pendingCli,
      false
    )
  })

  it('reseeds a picker on the last Screen pane and drops a legacy host', () => {
    const live = tab({ id: 'pty-1', agentId: 'claude' })
    const pending = tab({ id: 'cli-pending:next', pendingCli: true, agentId: null })
    const reseed = planCloseAgentTabPatch(
      {
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          [CLI_SURFACE_KEY]: { tabs: [live], layout: leaf(live.id), activeTabId: live.id }
        }
      },
      live.id,
      () => pending
    )
    assert.equal(reseed.cliMode, true)
    assert.equal(reseed.activeHostAgentId, CLI_SURFACE_KEY)
    assert.deepEqual(reseed.agentHostSessions?.[CLI_SURFACE_KEY], pendingCliPickerSurface(pending))

    const drop = planCloseAgentTabPatch(
      {
        cliMode: false,
        activeHostAgentId: 'claude',
        agentHostSessions: {
          claude: { tabs: [live], layout: leaf(live.id), activeTabId: live.id }
        }
      },
      live.id,
      () => pending
    )
    assert.equal(drop.activeHostAgentId, null)
    assert.equal(drop.agentHostSessions?.claude, undefined)
  })

  it('pins Screen mode and clears a missing legacy host on hydrate', () => {
    assert.equal(hydratedActiveHostAgentId(true, 'claude', {}), CLI_SURFACE_KEY)
    assert.equal(hydratedActiveHostAgentId(false, CLI_SURFACE_KEY, {}), null)
    assert.equal(hydratedActiveHostAgentId(false, 'gone', {}), null)
    assert.equal(hydratedActiveHostAgentId(false, 'claude', { claude: true }), 'claude')
  })

  it('splits a per-agent host and drops a hydrate-race duplicate id', () => {
    const a = tab({ id: 'pty-1', agentId: 'claude' })
    const next = planSplitAgentHost(
      { tabs: [a], layout: leaf(a.id), activeTabId: a.id },
      { focusId: a.id, newTabId: 'pty-2', axis: 'row', title: 'Claude-2', agentId: 'claude' }
    )
    assert.deepEqual(collectLeaves(next.layout!), ['pty-1', 'pty-2'])
    assert.equal(next.activeTabId, 'pty-2')
    assert.equal(next.tabs[1]?.title, 'Claude-2')
  })

  it('seeds a missing primary host and retargets a preferred Screen id', () => {
    const preferred = tab({ id: 'pref', agentId: 'claude' })
    const next = planActivateAgentHostAfterSpawn(
      {
        agentHostSessions: {
          [CLI_SURFACE_KEY]: {
            tabs: [preferred],
            layout: leaf(preferred.id),
            activeTabId: preferred.id
          }
        }
      },
      { agentId: 'claude', tabId: 'live', preferredId: preferred.id, title: 'Claude' }
    )
    assert.equal(next.cliMode, true)
    assert.equal(next.activeHostAgentId, CLI_SURFACE_KEY)
    assert.equal(next.agentHostSessions.claude?.tabs[0]?.id, 'live')
    assert.equal(next.agentHostSessions[CLI_SURFACE_KEY]?.activeTabId, 'live')
  })

  it('seeds a first per-agent host pane with a leaf layout', () => {
    const host = seedAgentHostSession('pty-1', 'claude', 'Claude')
    assert.equal(host.tabs[0]?.id, 'pty-1')
    assert.equal(host.tabs[0]?.agentId, 'claude')
    assert.equal(host.tabs[0]?.isAgent, false)
    assert.equal(host.activeTabId, 'pty-1')
    assert.deepEqual(collectLeaves(host.layout), ['pty-1'])
  })
})
