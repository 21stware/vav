/**
 * Agent mark at the top-right of the active selection chrome (icon only —
 * no outer plate). Tracks the selection box (or multi-select union) and is
 * clamped into the preview stage so document scroll never carries it away.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { BrandAppIcon } from './BrandAppIcon'

const SIZE = 26
/** Clear air outside the selection's top-right corner. */
const OUTSIDE_GAP = 8
const VIEW_PAD = 8

const SELECTED_SEL = [
  '.preview-select-region.selected',
  '.office-pick-target.selected',
  '.pdf-page.pdf-pick-page.selected',
  '.pdf-page .textLayer span.selected',
  '.preview-code-overlay.selected',
  'tr.selected',
  'tr.row-selected',
  '.zip-tree-row.selected',
  '[data-block-id].selected'
].join(',')

type Pos = { left: number; top: number; visible: boolean }
type Box = { left: number; top: number; right: number; bottom: number }

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function isRowLikeId(id: string): boolean {
  return /(?:^|-)row-\d+$/i.test(id) || /^row-\d+$/i.test(id)
}

/**
 * Empty sheet cells often promote the pick to the whole row, and the selected
 * class lands on the narrow gutter <th>. Prefer the enclosing <tr>.
 */
function resolveOne(host: HTMLElement, preferredId: string | null): HTMLElement | null {
  let target: HTMLElement | null = null
  if (preferredId) {
    const safe = escapeAttr(preferredId)
    target =
      host.querySelector<HTMLElement>(`[data-block-id="${safe}"].selected`) ||
      host.querySelector<HTMLElement>(`[data-block-id="${safe}"]`)
  }
  if (!target) {
    const all = host.querySelectorAll<HTMLElement>(SELECTED_SEL)
    target = all.length > 0 ? all[all.length - 1]! : null
  }
  if (!target) return null

  const gutter = target.closest(
    'th.csv-sheet-gutter, td.csv-sheet-gutter, th.structured-sheet-gutter, td.structured-sheet-gutter'
  )
  if (gutter || (preferredId && isRowLikeId(preferredId))) {
    const row = target.closest('tr')
    if (row instanceof HTMLElement) return row
  }

  const rect = target.getBoundingClientRect()
  if ((rect.width < 8 || rect.height < 8) && target.closest('table')) {
    const row = target.closest('tr')
    if (row instanceof HTMLElement) {
      const rowRect = row.getBoundingClientRect()
      if (rowRect.width >= 8 && rowRect.height >= 8) return row
    }
  }

  return target
}

/** Collect every selected paint box; fall back to the primary if none match. */
function collectSelected(host: HTMLElement, selectedIds: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  for (const id of selectedIds) {
    const el = resolveOne(host, id)
    if (el && !seen.has(el)) {
      seen.add(el)
      out.push(el)
    }
  }
  if (out.length === 0) {
    host.querySelectorAll<HTMLElement>(SELECTED_SEL).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el)
        out.push(el)
      }
    })
  }
  return out
}

function unionBox(els: HTMLElement[]): Box | null {
  let box: Box | null = null
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (!box) {
      box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    } else {
      box.left = Math.min(box.left, r.left)
      box.top = Math.min(box.top, r.top)
      box.right = Math.max(box.right, r.right)
      box.bottom = Math.max(box.bottom, r.bottom)
    }
  }
  return box
}

function computePos(host: HTMLElement, sel: Box | null): Pos {
  if (!sel) return { left: 0, top: 0, visible: false }
  const hostRect = host.getBoundingClientRect()
  if (hostRect.width < 40 || hostRect.height < 40) {
    return { left: 0, top: 0, visible: false }
  }
  // Completely outside the stage → hide.
  if (
    sel.bottom < hostRect.top ||
    sel.top > hostRect.bottom ||
    sel.right < hostRect.left ||
    sel.left > hostRect.right
  ) {
    return { left: 0, top: 0, visible: false }
  }

  // Top-right of the selection, outside the box so content stays clear.
  let left = sel.right - hostRect.left + OUTSIDE_GAP
  let top = sel.top - hostRect.top - SIZE - OUTSIDE_GAP

  const minL = VIEW_PAD
  const maxL = Math.max(VIEW_PAD, hostRect.width - SIZE - VIEW_PAD)
  const minT = VIEW_PAD
  const maxT = Math.max(VIEW_PAD, hostRect.height - SIZE - VIEW_PAD)

  if (left > maxL) left = sel.right - hostRect.left - SIZE
  if (top < minT) top = sel.top - hostRect.top + OUTSIDE_GAP

  left = Math.min(maxL, Math.max(minL, left))
  top = Math.min(maxT, Math.max(minT, top))

  return { left, top, visible: true }
}

export function SelectionAgentFab({
  hostRef,
  selectedIds,
  title,
  onClick
}: {
  hostRef: RefObject<HTMLElement | null>
  selectedIds: string[]
  title: string
  onClick: () => void
}): React.JSX.Element | null {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<Pos>({ left: 0, top: 0, visible: false })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || selectedIds.length === 0) {
      setPos({ left: 0, top: 0, visible: false })
      return
    }

    let raf = 0
    const update = (): void => {
      raf = 0
      const els = collectSelected(host, selectedIds)
      setPos(computePos(host, unionBox(els)))
    }
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    update()

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(host)

    host.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)

    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(schedule)
        : null
    mo?.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-block-id']
    })

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      mo?.disconnect()
      host.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [hostRef, selectedIds])

  if (!pos.visible) return null

  return (
    <button
      ref={btnRef}
      type="button"
      className="selection-agent-fab"
      title={title}
      aria-label={title}
      style={{ transform: `translate(${pos.left}px, ${pos.top}px)` }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
    >
      <span className="selection-agent-fab-mark" aria-hidden>
        <BrandAppIcon size={SIZE} appearance="any" className="selection-agent-fab-icon" />
      </span>
    </button>
  )
}
