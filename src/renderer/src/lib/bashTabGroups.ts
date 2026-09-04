import type { BashTabGroups, TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import { collectLeaves, reconcileLayout, removeLeaf } from './workspaceLayout.ts'
import {
  type BashPaneExtras,
  bashThenAgentTabs,
  planAppendUserBashTab,
  planBashSplit,
  planFirstBashPane,
  userBashTabsOnly
} from './workspacePty.ts'

export function emptyBashGroups(): BashTabGroups {
  return { order: [], layouts: {}, activeGroupId: '' }
}

/** Build groups from legacy single-tree state (one tab chip for the whole tree). */
export function migrateLegacyBashGroups(
  tabIds: string[],
  layout: TerminalLayoutNode | null,
  activeTabId: string
): BashTabGroups {
  if (tabIds.length === 0) return emptyBashGroups()
  const rootId = tabIds[0]!
  const leaves = layout ? collectLeaves(layout) : []
  const groupLayout: TerminalLayoutNode =
    leaves.length > 0
      ? layout!
      : { type: 'leaf', tabId: rootId, weight: 1 }
  const activeGroupId =
    tabIds.find((id) => leaves.includes(id) && id === activeTabId) ??
    tabIds.find((id) => leaves.includes(id)) ??
    rootId
  return {
    order: [rootId],
    layouts: { [rootId]: groupLayout },
    activeGroupId
  }
}

export function ensureBashGroups(
  groups: BashTabGroups | null | undefined,
  tabIds: string[],
  layout: TerminalLayoutNode | null,
  activeTabId: string
): BashTabGroups {
  if (groups && groups.order.length > 0) return groups
  return migrateLegacyBashGroups(tabIds, layout, activeTabId)
}

/**
 * Keep each tab chip's own split tree. Never fold every live PTY into the
 * active group's layout (that is what made tab switches look duplicated).
 */
export function reconcileBashGroups(
  groups: BashTabGroups | null | undefined,
  liveTabIds: string[],
  fallbackLayout: TerminalLayoutNode | null,
  activeTabId: string
): { groups: BashTabGroups | null; layout: TerminalLayoutNode | null } {
  const live = liveTabIds.filter(Boolean)
  if (live.length === 0) return { groups: null, layout: null }

  const liveSet = new Set(live)
  const base = ensureBashGroups(groups, live, fallbackLayout, activeTabId)
  const layouts: Record<string, TerminalLayoutNode> = {}
  const order: string[] = []
  const assigned = new Set<string>()

  for (const rootId of base.order) {
    const node = base.layouts[rootId]
    if (!node) continue
    const keep = collectLeaves(node).filter((id) => liveSet.has(id))
    const next = reconcileLayout(node, keep)
    if (!next) continue
    order.push(rootId)
    layouts[rootId] = next
    for (const id of collectLeaves(next)) assigned.add(id)
  }

  for (const id of live) {
    if (assigned.has(id)) continue
    order.push(id)
    layouts[id] = { type: 'leaf', tabId: id, weight: 1 }
    assigned.add(id)
  }

  if (order.length === 0) return { groups: null, layout: null }

  let activeGroupId = base.activeGroupId
  if (!order.includes(activeGroupId)) {
    activeGroupId =
      groupIdForTab({ order, layouts, activeGroupId: '' }, activeTabId) ?? order[0]!
  }

  return {
    groups: { order, layouts, activeGroupId },
    layout: layouts[activeGroupId] ?? null
  }
}

export function groupIdForTab(groups: BashTabGroups, tabId: string): string | null {
  for (const rootId of groups.order) {
    const node = groups.layouts[rootId]
    if (!node) {
      if (rootId === tabId) return rootId
      continue
    }
    if (collectLeaves(node).includes(tabId)) return rootId
  }
  return null
}

export function bashGroupLabel(tabs: TerminalTab[], layout: TerminalLayoutNode | null): string {
  const leaves = layout ? collectLeaves(layout) : []
  const titles = leaves
    .map((id) => tabs.find((t) => t.id === id)?.title?.trim())
    .filter((t): t is string => !!t)
  return titles.length > 0 ? titles.join(' | ') : 'bash'
}

function stashActiveGroupLayout(
  groups: BashTabGroups,
  layout: TerminalLayoutNode | null
): BashTabGroups {
  if (!groups.activeGroupId || !layout) return groups
  return {
    ...groups,
    layouts: { ...groups.layouts, [groups.activeGroupId]: layout }
  }
}

/** ⌘T — new parallel tab chip; does not split the current pane. */
export function planNewBashTab(
  s: {
    tabs: TerminalTab[]
    layout: TerminalLayoutNode | null
    activeTabId: string
    bashGroups: BashTabGroups | null
  },
  tabId: string,
  extras?: BashPaneExtras
): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode
  activeTabId: string
  bashGroups: BashTabGroups
} {
  const bashIds = userBashTabsOnly(s.tabs).map((t) => t.id)
  let groups = stashActiveGroupLayout(
    ensureBashGroups(s.bashGroups, bashIds, s.layout, s.activeTabId),
    s.layout
  )
  const index = bashIds.length + 1
  const appended = planAppendUserBashTab(s.tabs, tabId, extras, index)
  const leaf: TerminalLayoutNode = { type: 'leaf', tabId, weight: 1 }
  groups = {
    order: [...groups.order, tabId],
    layouts: { ...groups.layouts, [tabId]: leaf },
    activeGroupId: tabId
  }
  return {
    tabs: appended.tabs,
    layout: leaf,
    activeTabId: tabId,
    bashGroups: groups
  }
}

/** ⌘D — horizontal split inside the focused bash tab group. */
export function planSplitBashPane(
  s: {
    tabs: TerminalTab[]
    layout: TerminalLayoutNode | null
    activeTabId: string
    bashGroups: BashTabGroups | null
  },
  opts: {
    focusId: string
    newTabId: string
    axis: import('../../../shared/types.ts').TerminalSplitAxis
    extras?: BashPaneExtras
  }
): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode
  activeTabId: string
  bashGroups: BashTabGroups
} {
  const bashIds = userBashTabsOnly(s.tabs).map((t) => t.id)
  let groups = ensureBashGroups(s.bashGroups, bashIds, s.layout, s.activeTabId)
  const focusGroup =
    groupIdForTab(groups, opts.focusId) ?? groups.activeGroupId ?? opts.focusId
  if (!groups.order.includes(focusGroup)) {
    groups = {
      ...groups,
      order: [...groups.order, focusGroup],
      layouts: {
        ...groups.layouts,
        [focusGroup]: s.layout ?? { type: 'leaf', tabId: opts.focusId, weight: 1 }
      }
    }
  }
  const split = planBashSplit(
    {
      tabs: s.tabs,
      layout: groups.layouts[focusGroup] ?? s.layout ?? { type: 'leaf', tabId: opts.focusId, weight: 1 }
    },
    opts
  )
  groups = {
    ...groups,
    activeGroupId: focusGroup,
    layouts: { ...groups.layouts, [focusGroup]: split.layout }
  }
  return {
    tabs: split.tabs,
    layout: split.layout,
    activeTabId: split.activeTabId,
    bashGroups: groups
  }
}

/** First bash in an empty tray. */
export function planFirstBashTab(
  tabs: TerminalTab[],
  tabId: string,
  extras?: BashPaneExtras
): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode
  activeTabId: string
  bashGroups: BashTabGroups
} {
  const first = planFirstBashPane(tabs, tabId, extras)
  const leaf = first.layout
  return {
    ...first,
    bashGroups: {
      order: [tabId],
      layouts: { [tabId]: leaf },
      activeGroupId: tabId
    }
  }
}

/** Switch the visible bash tab chip (saves the outgoing group's layout). */
export function planSelectBashGroup(
  s: {
    layout: TerminalLayoutNode | null
    bashGroups: BashTabGroups | null
    tabs: TerminalTab[]
    activeTabId: string
  },
  groupId: string
): {
  layout: TerminalLayoutNode | null
  activeTabId: string
  bashGroups: BashTabGroups
} | null {
  const bashIds = userBashTabsOnly(s.tabs).map((t) => t.id)
  let groups = stashActiveGroupLayout(
    ensureBashGroups(s.bashGroups, bashIds, s.layout, s.activeTabId),
    s.layout
  )
  if (!groups.order.includes(groupId)) return null
  const nextLayout = groups.layouts[groupId] ?? null
  const leaves = nextLayout ? collectLeaves(nextLayout) : [groupId]
  const activeTabId = leaves.includes(s.activeTabId) ? s.activeTabId : (leaves[0] ?? groupId)
  return {
    layout: nextLayout,
    activeTabId,
    bashGroups: { ...groups, activeGroupId: groupId }
  }
}

/** Close a pane; drop the tab chip when its group is empty. */
export function closeBashTabWithGroupsPatch(
  s: {
    tabs: TerminalTab[]
    layout: TerminalLayoutNode | null
    activeTabId: string
    bashGroups: BashTabGroups | null
  },
  tabId: string
): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
  bashGroups: BashTabGroups | null
} {
  const remaining = userBashTabsOnly(s.tabs).filter((t) => t.id !== tabId)
  const groups = stashActiveGroupLayout(
    ensureBashGroups(
      s.bashGroups,
      userBashTabsOnly(s.tabs).map((t) => t.id),
      s.layout,
      s.activeTabId
    ),
    s.layout
  )
  const groupId = groupIdForTab(groups, tabId)
  const tabs = bashThenAgentTabs(remaining)

  if (!groupId) {
    return {
      tabs,
      layout: s.layout ? removeLeaf(s.layout, tabId) : null,
      activeTabId: s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId,
      bashGroups: remaining.length === 0 ? null : groups
    }
  }

  const prevGroupLayout = groups.layouts[groupId] ?? s.layout
  const nextGroupLayout = prevGroupLayout ? removeLeaf(prevGroupLayout, tabId) : null
  const groupLeaves = nextGroupLayout ? collectLeaves(nextGroupLayout) : []

  let nextGroups: BashTabGroups | null = { ...groups }
  if (groupLeaves.length === 0) {
    const { [groupId]: _drop, ...restLayouts } = groups.layouts
    const order = groups.order.filter((id) => id !== groupId)
    nextGroups =
      order.length === 0
        ? null
        : {
            order,
            layouts: restLayouts,
            activeGroupId:
              groups.activeGroupId === groupId ? (order[0] ?? '') : groups.activeGroupId
          }
  } else {
    nextGroups = {
      ...groups,
      layouts: { ...groups.layouts, [groupId]: nextGroupLayout! }
    }
  }

  const activeGroupId = nextGroups?.activeGroupId ?? ''
  const layout =
    activeGroupId && nextGroups?.layouts[activeGroupId]
      ? nextGroups.layouts[activeGroupId]!
      : nextGroupLayout
  let activeTabId = s.activeTabId
  if (s.activeTabId === tabId) {
    activeTabId = groupLeaves[0] ?? tabs[0]?.id ?? ''
  }

  return { tabs, layout, activeTabId, bashGroups: nextGroups }
}

/** Close every pane that belongs to one tab chip. */
export function closeBashGroupPatch(
  s: {
    tabs: TerminalTab[]
    layout: TerminalLayoutNode | null
    activeTabId: string
    bashGroups: BashTabGroups | null
  },
  groupId: string
): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
  bashGroups: BashTabGroups | null
} {
  const groups = stashActiveGroupLayout(
    ensureBashGroups(
      s.bashGroups,
      userBashTabsOnly(s.tabs).map((t) => t.id),
      s.layout,
      s.activeTabId
    ),
    s.layout
  )
  const node = groups.layouts[groupId]
  const drop = new Set(node ? collectLeaves(node) : [groupId])
  let next = {
    tabs: s.tabs,
    layout: s.layout,
    activeTabId: s.activeTabId,
    bashGroups: groups as BashTabGroups | null
  }
  for (const tabId of drop) {
    next = closeBashTabWithGroupsPatch(next, tabId)
  }
  return next
}

/** Tab chips for the tools header — one per bash group. */
export function bashGroupChips(
  tabs: TerminalTab[],
  groups: BashTabGroups | null,
  layout: TerminalLayoutNode | null
): Array<{ groupId: string; label: string; tabIds: string[] }> {
  const bashTabs = userBashTabsOnly(tabs)
  const g = ensureBashGroups(
    groups,
    bashTabs.map((t) => t.id),
    layout,
    ''
  )
  return g.order.map((groupId) => {
    const groupLayout = g.layouts[groupId] ?? { type: 'leaf' as const, tabId: groupId, weight: 1 }
    return {
      groupId,
      label: bashGroupLabel(bashTabs, groupLayout),
      tabIds: collectLeaves(groupLayout)
    }
  })
}
