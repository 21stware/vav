import type { TerminalLayoutNode, TerminalSplitAxis } from './types'

const MIN_WEIGHT = 0.35

export function swarmLeaf(id: string, weight = 1): TerminalLayoutNode {
  return { type: 'leaf', tabId: id, weight }
}

export function collectSwarmLeaves(node: TerminalLayoutNode | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'leaf') return [node.tabId]
  return [...collectSwarmLeaves(node.children[0]), ...collectSwarmLeaves(node.children[1])]
}

export function splitSwarmLeaf(
  node: TerminalLayoutNode,
  tabId: string,
  direction: TerminalSplitAxis,
  newTabId: string,
  newWeight = 1
): TerminalLayoutNode {
  if (node.type === 'leaf') {
    if (node.tabId !== tabId) return node
    const nw = Math.max(MIN_WEIGHT, Math.min(1.65, newWeight))
    const ow = Math.max(MIN_WEIGHT, 2 - nw)
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
      splitSwarmLeaf(node.children[0], tabId, direction, newTabId, newWeight),
      splitSwarmLeaf(node.children[1], tabId, direction, newTabId, newWeight)
    ]
  }
}

export function removeSwarmLeaf(
  node: TerminalLayoutNode,
  tabId: string
): TerminalLayoutNode | null {
  if (node.type === 'leaf') return node.tabId === tabId ? null : node
  const left = removeSwarmLeaf(node.children[0], tabId)
  const right = removeSwarmLeaf(node.children[1], tabId)
  if (!left && !right) return null
  if (!left) return { ...right!, weight: node.weight }
  if (!right) return { ...left, weight: node.weight }
  return { ...node, children: [left, right] }
}

export function insertSwarmLeaf(
  layout: TerminalLayoutNode | null,
  focusId: string | null,
  axis: TerminalSplitAxis,
  newId: string
): TerminalLayoutNode {
  if (!layout) return swarmLeaf(newId)
  const leaves = collectSwarmLeaves(layout)
  if (leaves.includes(newId)) return layout
  const at = focusId && leaves.includes(focusId) ? focusId : (leaves[0] ?? newId)
  if (!leaves.length) return swarmLeaf(newId)
  return splitSwarmLeaf(layout, at, axis, newId)
}

/** Drop leaves that are not in `keep`; collapse empty branches. */
export function pruneSwarmLeaves(
  node: TerminalLayoutNode,
  keep: ReadonlySet<string>
): TerminalLayoutNode | null {
  if (node.type === 'leaf') return keep.has(node.tabId) ? node : null
  const left = pruneSwarmLeaves(node.children[0], keep)
  const right = pruneSwarmLeaves(node.children[1], keep)
  if (!left && !right) return null
  if (!left) return { ...right!, weight: node.weight }
  if (!right) return { ...left, weight: node.weight }
  return { ...node, children: [left, right] }
}

/**
 * Remembered topology includes parked panes. Prefer the previous full tree
 * when it already names every visible leaf; otherwise start from the live
 * tree and re-attach parked leaves.
 */
export function rememberSwarmLayout(
  prevFull: TerminalLayoutNode | null | undefined,
  visible: TerminalLayoutNode
): TerminalLayoutNode {
  if (!prevFull) return visible
  const visibleIds = collectSwarmLeaves(visible)
  const prevIds = collectSwarmLeaves(prevFull)
  if (visibleIds.every((id) => prevIds.includes(id))) return prevFull
  let next = visible
  for (const id of prevIds) {
    if (visibleIds.includes(id)) continue
    next = insertSwarmLeaf(next, visibleIds[0] ?? id, 'row', id)
  }
  return next
}

/**
 * Re-open a parked pane at its last tree slot. Falls back to a row split of
 * the focused leaf when that session was never in the remembered layout.
 */
export function restoreSwarmLeaf(
  visible: TerminalLayoutNode,
  remembered: TerminalLayoutNode | null | undefined,
  id: string,
  fallbackFocusId: string | null
): TerminalLayoutNode {
  if (collectSwarmLeaves(visible).includes(id)) return visible
  if (remembered && collectSwarmLeaves(remembered).includes(id)) {
    const keep = new Set([...collectSwarmLeaves(visible), id])
    return (
      pruneSwarmLeaves(remembered, keep) ??
      insertSwarmLeaf(visible, fallbackFocusId, 'row', id)
    )
  }
  return insertSwarmLeaf(visible, fallbackFocusId, 'row', id)
}

export function sanitizeSwarmLayout(value: unknown): TerminalLayoutNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as TerminalLayoutNode
  if (node.type === 'leaf') {
    if (typeof node.tabId !== 'string' || !node.tabId.trim()) return null
    const weight = typeof node.weight === 'number' && Number.isFinite(node.weight) ? node.weight : 1
    return { type: 'leaf', tabId: node.tabId, weight }
  }
  if (node.type !== 'branch') return null
  if (node.direction !== 'row' && node.direction !== 'column') return null
  if (!Array.isArray(node.children) || node.children.length !== 2) return null
  const left = sanitizeSwarmLayout(node.children[0])
  const right = sanitizeSwarmLayout(node.children[1])
  if (!left || !right) return null
  const weight = typeof node.weight === 'number' && Number.isFinite(node.weight) ? node.weight : 1
  return { type: 'branch', direction: node.direction, weight, children: [left, right] }
}

export function swarmRootId(
  conversationId: string,
  parentId: string | null | undefined
): string {
  return parentId || conversationId
}

export function swarmChildrenOf<T extends { id: string; swarmParentId?: string | null }>(
  conversations: readonly T[],
  parentId: string
): T[] {
  return conversations
    .filter((c) => c.swarmParentId === parentId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function expandRemovedSwarmIds<T extends { id: string; swarmParentId?: string | null }>(
  conversations: readonly T[],
  ids: readonly string[]
): string[] {
  const wanted = new Set(ids)
  for (const row of conversations) {
    if (row.swarmParentId && wanted.has(row.swarmParentId)) wanted.add(row.id)
  }
  return [...wanted]
}
