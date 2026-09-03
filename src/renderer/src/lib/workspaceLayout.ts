import type { TerminalLayoutNode, TerminalSplitAxis } from '../../../shared/types.ts'

/**
 * Replace the leaf with tabId by a branch(direction, [old, newLeaf]).
 * New pending panes get a smaller weight so live agents keep more of the Screen
 * (avoids 50/50 “empty ocean” under a row of TUIs when ⌘⇧D-ing a picker).
 */
export function splitLeaf(
  node: TerminalLayoutNode,
  tabId: string,
  direction: TerminalSplitAxis,
  newTabId: string,
  /** Weight for the new leaf; existing keeps the complement toward 2. */
  newWeight = 1
): TerminalLayoutNode {
  if (node.type === 'leaf') {
    if (node.tabId !== tabId) return node
    const nw = Math.max(0.35, Math.min(1.65, newWeight))
    const ow = Math.max(0.35, 2 - nw)
    return {
      type: 'branch',
      direction,
      weight: node.weight,
      children: [
        { type: 'leaf', tabId: node.tabId, weight: ow },
        { type: 'leaf', tabId: newTabId, weight: nw }
      ]
    }
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], tabId, direction, newTabId, newWeight),
      splitLeaf(node.children[1], tabId, direction, newTabId, newWeight)
    ]
  }
}

export function removeLeaf(node: TerminalLayoutNode, tabId: string): TerminalLayoutNode | null {
  if (node.type === 'leaf') return node.tabId === tabId ? null : node
  const left = removeLeaf(node.children[0], tabId)
  const right = removeLeaf(node.children[1], tabId)
  if (!left && !right) return null
  if (!left) return { ...right!, weight: node.weight }
  if (!right) return { ...left, weight: node.weight }
  return { ...node, children: [left, right] }
}

export function collectLeaves(node: TerminalLayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'leaf') return [node.tabId]
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])]
}

/** Build a balanced-ish binary tree of leaves (row splits) for hydrated tabs. */
export function layoutFromTabIds(tabIds: string[]): TerminalLayoutNode | null {
  if (tabIds.length === 0) return null
  if (tabIds.length === 1) return { type: 'leaf', tabId: tabIds[0]!, weight: 1 }
  const mid = Math.ceil(tabIds.length / 2)
  const left = layoutFromTabIds(tabIds.slice(0, mid))
  const right = layoutFromTabIds(tabIds.slice(mid))
  if (!left) return right
  if (!right) return left
  return {
    type: 'branch',
    direction: 'row',
    weight: 1,
    children: [
      { ...left, weight: 1 },
      { ...right, weight: 1 }
    ]
  }
}

/**
 * Reconcile a live PTY id set into an existing split tree without discarding
 * direction / weights. `layoutFromTabIds` always builds `row` branches, so a
 * naïve hydrate after ⌘⇧D would flatten top/bottom splits into left/right.
 */
export function reconcileLayout(
  existing: TerminalLayoutNode | null,
  tabIds: string[]
): TerminalLayoutNode | null {
  if (tabIds.length === 0) return null
  if (!existing) return layoutFromTabIds(tabIds)

  const want = new Set(tabIds)
  let layout: TerminalLayoutNode | null = existing

  for (const id of collectLeaves(layout)) {
    if (!want.has(id)) {
      layout = layout ? removeLeaf(layout, id) : null
    }
  }

  const have = new Set(collectLeaves(layout))
  // Same membership → keep topology (column vs row, flex weights).
  if (tabIds.length === have.size && tabIds.every((id) => have.has(id))) {
    return layout
  }

  for (const id of tabIds) {
    if (have.has(id)) continue
    if (!layout) {
      layout = { type: 'leaf', tabId: id, weight: 1 }
    } else {
      // Hydrate-only attach (other window / race before splitAgentHost patch).
      // Keep the tree's existing axis — always `row` flattened ⌘⇧D column splits.
      const leaves = collectLeaves(layout)
      const focus = leaves[leaves.length - 1]!
      layout = splitLeaf(layout, focus, layoutPrimaryAxis(layout), id)
    }
    have.add(id)
  }
  return layout
}

/** True if any branch is top/bottom (⌘⇧D). `layoutFromTabIds` only builds row. */
export function layoutHasColumn(node: TerminalLayoutNode | null | undefined): boolean {
  if (!node || node.type === 'leaf') return false
  if (node.direction === 'column') return true
  return layoutHasColumn(node.children[0]) || layoutHasColumn(node.children[1])
}

/** Root (or first) split axis — used when hydrate attaches a new leaf. */
export function layoutPrimaryAxis(node: TerminalLayoutNode | null | undefined): TerminalSplitAxis {
  if (!node || node.type === 'leaf') return 'row'
  return node.direction === 'column' ? 'column' : 'row'
}

/** How well a layout covers `tabIds` (hits*10 − orphans). Missing layout → -1. */
export function scoreLayoutLeaves(
  layout: TerminalLayoutNode | null | undefined,
  tabIds: string[]
): number {
  if (!layout) return -1
  const want = new Set(tabIds)
  const leaves = collectLeaves(layout)
  let hit = 0
  for (const id of leaves) if (want.has(id)) hit++
  const orphan = leaves.filter((id) => !want.has(id)).length
  return hit * 10 - orphan
}

/**
 * Prefer the layout tree that already names the current pane ids.
 * Stale remote trees still holding `cli-pending:…` must not beat a local tree
 * that already replaced those leaves with real PTY ids (would re-attach with
 * `row` and shove the new agent to the far right after ⌘⇧D).
 *
 * On equal leaf coverage, never let a lagging all-`row` remote wipe a local
 * `column` tree (syncPtyLayouts is async; pty:changed hydrate often wins the race).
 */
export function pickCliLayoutBase(
  prevLayout: TerminalLayoutNode | null | undefined,
  remoteLayout: TerminalLayoutNode | null | undefined,
  tabIds: string[]
): TerminalLayoutNode | null {
  const sp = scoreLayoutLeaves(prevLayout, tabIds)
  const sr = scoreLayoutLeaves(remoteLayout, tabIds)
  if (sp > sr) return prevLayout ?? null
  if (sr > sp) return remoteLayout ?? null
  // Equal completeness (same leaves): keep real axes, not layoutFromTabIds rows.
  const pc = layoutHasColumn(prevLayout)
  const rc = layoutHasColumn(remoteLayout)
  if (pc && !rc) return prevLayout ?? null
  if (rc && !pc) return remoteLayout ?? null
  // True tie: prefer local (just-split window) over remote lag.
  // Cold multi-window reclaim has prev=null and already took sr > sp / remote above.
  return prevLayout ?? remoteLayout ?? null
}

/** Stable fingerprint of split axes so hydrate can tell row vs column apart. */
export function layoutDirectionKey(node: TerminalLayoutNode | null): string {
  if (!node) return ''
  if (node.type === 'leaf') return `L:${node.tabId}`
  return `B:${node.direction}(${layoutDirectionKey(node.children[0])}|${layoutDirectionKey(node.children[1])})`
}

/** Restore the persisted CLI tree if hydrate flattened row vs column mid-IPC. */
export function shouldRestoreCliLayoutAfterSync(
  sentCli: TerminalLayoutNode | null,
  now: { layout: TerminalLayoutNode | null; tabs: Array<{ id: string }> } | undefined
): boolean {
  if (!sentCli || !now) return false
  return (
    layoutDirectionKey(now.layout) !== layoutDirectionKey(sentCli) &&
    (layoutHasColumn(sentCli) ||
      scoreLayoutLeaves(sentCli, now.tabs.map((t) => t.id)) >=
        scoreLayoutLeaves(now.layout, now.tabs.map((t) => t.id)))
  )
}
