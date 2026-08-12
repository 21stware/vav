/**
 * Spatial navigation across a Swarm multi-split (binary tree of panes).
 *
 * Geometry, not tree-walk: users think in screen space (“pane to my right”),
 * and a binary layout can nest row/column arbitrarily, so DOM bounding boxes
 * are the source of truth.
 *
 * Preference order (matches VS Code / i3 intuition):
 *  1. Candidates in the requested half-plane (by center)
 *  2. Prefer ones that overlap on the orthogonal axis (true edge neighbors)
 *  3. Closest along the travel axis; tie-break by orthogonal center alignment
 *  4. If still empty, visual reading-order step (top→bottom, left→right)
 */

export type PaneNavDirection = 'left' | 'right' | 'up' | 'down'

export interface PaneRect {
  tabId: string
  left: number
  top: number
  right: number
  bottom: number
}

/** Allow tiny layout gaps / subpixel seams between flex panes. */
const EDGE_SLACK = 12

function centerX(r: PaneRect): number {
  return (r.left + r.right) / 2
}

function centerY(r: PaneRect): number {
  return (r.top + r.bottom) / 2
}

function overlapsOrthogonal(from: PaneRect, to: PaneRect, dir: PaneNavDirection): boolean {
  if (dir === 'left' || dir === 'right') {
    return to.top < from.bottom - 1 && to.bottom > from.top + 1
  }
  return to.left < from.right - 1 && to.right > from.left + 1
}

/**
 * Half-plane test by centers. More reliable than edge tests when flex
 * resizers / subpixels make sibling edges slightly overlap or invert.
 */
function isInDirection(from: PaneRect, to: PaneRect, dir: PaneNavDirection): boolean {
  switch (dir) {
    case 'right':
      return centerX(to) > centerX(from) + 1
    case 'left':
      return centerX(to) < centerX(from) - 1
    case 'down':
      return centerY(to) > centerY(from) + 1
    case 'up':
      return centerY(to) < centerY(from) - 1
  }
}

/** Non-negative distance along the travel axis (edge-to-edge when possible). */
function primaryDistance(from: PaneRect, to: PaneRect, dir: PaneNavDirection): number {
  switch (dir) {
    case 'right':
      return Math.max(0, to.left - from.right)
    case 'left':
      return Math.max(0, from.left - to.right)
    case 'down':
      return Math.max(0, to.top - from.bottom)
    case 'up':
      return Math.max(0, from.top - to.bottom)
  }
}

function orthogonalCenterDelta(from: PaneRect, to: PaneRect, dir: PaneNavDirection): number {
  if (dir === 'left' || dir === 'right') {
    return Math.abs(centerY(from) - centerY(to))
  }
  return Math.abs(centerX(from) - centerX(to))
}

function visualSort(panes: readonly PaneRect[]): PaneRect[] {
  return [...panes].sort((a, b) => {
    if (Math.abs(a.top - b.top) > EDGE_SLACK) return a.top - b.top
    return a.left - b.left
  })
}

/** Reading-order step when pure geometry finds nothing (degenerate stacks). */
function readingOrderNeighbor(
  fromTabId: string,
  dir: PaneNavDirection,
  panes: readonly PaneRect[]
): string | null {
  const ordered = visualSort(panes)
  const index = ordered.findIndex((p) => p.tabId === fromTabId)
  if (index < 0) return null
  if (dir === 'right' || dir === 'down') {
    return ordered[index + 1]?.tabId ?? null
  }
  return ordered[index - 1]?.tabId ?? null
}

/**
 * Pick the best neighbor of `fromTabId` in `dir`.
 * Pure — pass measured rects (tests / DOM).
 */
export function findNeighborPane(
  fromTabId: string,
  dir: PaneNavDirection,
  panes: readonly PaneRect[]
): string | null {
  const from = panes.find((p) => p.tabId === fromTabId)
  if (!from || panes.length < 2) return null

  const candidates = panes.filter(
    (p) => p.tabId !== fromTabId && isInDirection(from, p, dir)
  )

  if (candidates.length > 0) {
    const overlapping = candidates.filter((p) => overlapsOrthogonal(from, p, dir))
    const pool = overlapping.length > 0 ? overlapping : candidates

    pool.sort((a, b) => {
      const dA = primaryDistance(from, a, dir)
      const dB = primaryDistance(from, b, dir)
      if (dA !== dB) return dA - dB
      const oA = orthogonalCenterDelta(from, a, dir)
      const oB = orthogonalCenterDelta(from, b, dir)
      if (oA !== oB) return oA - oB
      if (a.top !== b.top) return a.top - b.top
      return a.left - b.left
    })

    return pool[0]?.tabId ?? null
  }

  return readingOrderNeighbor(fromTabId, dir, panes)
}

/** Resolve which pane currently owns keyboard focus (DOM), if any. */
export function focusedCliPaneId(root?: ParentNode | null): string | null {
  const active = document.activeElement as HTMLElement | null
  if (!active) return null
  const scope =
    root ??
    document.querySelector('.terminal-host-main:not(.is-surface-parked)') ??
    document
  if (!(scope instanceof Element) && scope !== document) return null
  const pane = active.closest('[data-cli-pane]') as HTMLElement | null
  if (!pane) return null
  // Must belong to the live Swarm surface (not a parked Thread keep-alive).
  if (
    pane.closest('.is-surface-parked') ||
    !pane.closest('.terminal-host-main:not(.is-surface-parked)')
  ) {
    return null
  }
  return pane.dataset.cliPane ?? null
}

/** Read visible Swarm pane boxes from the live DOM. */
export function measureCliPaneRects(root?: ParentNode | null): PaneRect[] {
  const scope =
    root ??
    document.querySelector('.terminal-host-main:not(.is-surface-parked)') ??
    document
  const nodes = scope.querySelectorAll('[data-cli-pane]')
  const out: PaneRect[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const el = node as HTMLElement
    if (el.closest('.is-surface-parked')) continue
    const tabId = el.dataset.cliPane
    if (!tabId || seen.has(tabId)) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    seen.add(tabId)
    out.push({
      tabId,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom
    })
  }
  return out
}

export function arrowKeyToPaneDirection(key: string): PaneNavDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    default:
      return null
  }
}
