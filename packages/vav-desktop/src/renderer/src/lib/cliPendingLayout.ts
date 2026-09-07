import type { TerminalLayoutNode, TerminalTab } from '@shared/types'

/** Pending CLI picker pane ids — no PTY until the user assigns an agent. */
export const CLI_PENDING_PREFIX = 'cli-pending:'

export function isPendingCliTabId(id: string): boolean {
  return id.startsWith(CLI_PENDING_PREFIX)
}

function layoutLeaves(node: TerminalLayoutNode | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'leaf') return [node.tabId]
  return [...layoutLeaves(node.children[0]), ...layoutLeaves(node.children[1])]
}

export function pendingTabFromId(id: string): TerminalTab {
  return {
    id,
    title: 'CLI',
    isAgent: false,
    agentId: null,
    pendingCli: true,
    splitWeight: 1
  }
}

/** Mint a new picker pane id. */
export function makePendingCliTab(): TerminalTab {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `${CLI_PENDING_PREFIX}${crypto.randomUUID()}`
      : `${CLI_PENDING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return pendingTabFromId(id)
}

/** Rebuild picker tabs from a persisted layout (pending leaves have no PTY meta). */
export function pendingTabsFromLayout(
  layout: TerminalLayoutNode | null | undefined
): TerminalTab[] {
  return layoutLeaves(layout).filter(isPendingCliTabId).map(pendingTabFromId)
}

/** Swap a leaf tab id (pending picker → real PTY) without reshaping the tree. */
export function replaceLayoutTabId(
  node: TerminalLayoutNode | null,
  fromId: string,
  toId: string
): TerminalLayoutNode | null {
  if (!node) return null
  if (fromId === toId) return node
  if (node.type === 'leaf') {
    return node.tabId === fromId ? { ...node, tabId: toId } : node
  }
  return {
    ...node,
    children: [
      replaceLayoutTabId(node.children[0], fromId, toId)!,
      replaceLayoutTabId(node.children[1], fromId, toId)!
    ]
  }
}

/**
 * Companion closed every live pane and reseeded a picker. Main still holds the
 * dead PTY tabs (hydrate projection is empty). Adopt the remote pending leaves
 * instead of keeping a blank Screen.
 *
 * If this window already has a picker (enterCliMode / list race), keep it.
 */
export function adoptRemotePendingTabs(
  prevTabs: readonly Pick<TerminalTab, 'pendingCli'>[] | undefined,
  remoteLayout: TerminalLayoutNode | null | undefined
): TerminalTab[] | null {
  if ((prevTabs ?? []).some((t) => t.pendingCli)) return null
  const pending = pendingTabsFromLayout(remoteLayout)
  return pending.length > 0 ? pending : null
}
