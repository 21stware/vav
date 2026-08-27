/**
 * Agent mark at the top-right of the active selection chrome (icon only —
 * no outer plate). Lives in the screen-space HUD: it tracks the subject's
 * projected box and never inherits the document's zoom transform.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { BrandAppIcon } from './BrandAppIcon'
import {
  collectSelectedElements,
  unionClientRects,
  type ClientRect
} from '../lib/selectionChrome'

const SIZE = 26
/** Clear air outside the selection's top-right corner. */
const OUTSIDE_GAP = 8
const VIEW_PAD = 8

type Pos = { left: number; top: number; visible: boolean }

/** Bottom of frozen sheet chrome (toolbar + sticky thead) inside the stage. */
function reservedTop(host: HTMLElement, hostTop: number): number {
  let bottom = hostTop
  host
    .querySelectorAll<HTMLElement>(
      'thead, .structured-sheet-toolbar, .csv-sheet-toolbar'
    )
    .forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.bottom > bottom) bottom = r.bottom
    })
  return Math.max(VIEW_PAD, bottom - hostTop + VIEW_PAD)
}

function computePos(host: HTMLElement, sel: ClientRect | null): Pos {
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
  // Using viewport-relative coordinates because we portal to body.
  let left = sel.right + OUTSIDE_GAP
  let top = sel.top - SIZE - OUTSIDE_GAP

  // Clamp to window edges with VIEW_PAD.
  const minL = VIEW_PAD
  const maxL = window.innerWidth - SIZE - VIEW_PAD
  const minT = VIEW_PAD
  const maxT = window.innerHeight - SIZE - VIEW_PAD

  // If outside right, move inside selection.
  if (left > maxL) left = sel.right - SIZE
  // If outside top, move below selection top.
  if (top < minT) top = sel.top + OUTSIDE_GAP

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
      const els = collectSelectedElements(host, selectedIds)
      setPos(computePos(host, unionClientRects(els, host)))
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

  return createPortal(
    <button
      ref={btnRef}
      type="button"
      className="selection-agent-fab"
      title={title}
      aria-label={title}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate(${pos.left}px, ${pos.top}px)`,
        zIndex: 9999
      }}
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
    </button>,
    document.body
  )
}
