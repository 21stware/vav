/**
 * Click-to-pick without blocking native text select/copy.
 *
 * - Simple click (little/no movement) → pick for Agent conversation
 * - Drag (moved past slop) → leave the browser free to select text (copy)
 *
 * Never call preventDefault on mousedown — that kills selection.
 *
 * ## Focus ownership
 *
 * Comment inputs in the agent column often hold focus between picks. On
 * mousedown the browser blurs that input *before* mouseup. A capture-phase
 * `window` blur listener would see every element blur and cancel the pick —
 * first click only defocuses the comment, second click finally selects.
 * Only cancel on true window-level loss of focus (alt-tab) or tab hide.
 */

import type { MouseEvent as ReactMouseEvent } from 'react'

/** Max pointer movement (px) still treated as a click, not a drag. */
export const CLICK_PICK_SLOP_PX = 6

/**
 * True while a pick gesture is armed (mousedown → mouseup). Comment blur
 * handlers can consult this so they do not fight the canvas pick.
 */
let pickGestureDepth = 0

export function isPickGestureActive(): boolean {
  return pickGestureDepth > 0
}

export type ClickPickPointer = {
  button: number
  clientX: number
  clientY: number
}

/**
 * Schedule a pick on mouseup if the gesture was a click, not a text-drag.
 * Call from mousedown / onMouseDown. Prefer stopPropagation for nested targets;
 * do not preventDefault.
 */
export function scheduleClickPick(
  event: ClickPickPointer,
  onPick: () => void,
  options?: {
    /** Optional window/document for iframe office viewers. */
    win?: Window
  }
): void {
  if (event.button !== 0) return
  const win = options?.win ?? (typeof window !== 'undefined' ? window : null)
  if (!win) return

  const startX = event.clientX
  const startY = event.clientY
  const doc = win.document
  pickGestureDepth += 1

  const cleanup = (): void => {
    pickGestureDepth = Math.max(0, pickGestureDepth - 1)
    win.removeEventListener('mouseup', onUp, true)
    // Bubble-only: element blurs must NOT cancel (comment field → canvas).
    win.removeEventListener('blur', onWindowBlur)
    doc.removeEventListener('visibilitychange', onVisibility, true)
  }

  const onUp = (up: MouseEvent): void => {
    cleanup()
    if (up.button !== 0) return
    const moved =
      Math.hypot(up.clientX - startX, up.clientY - startY) > CLICK_PICK_SLOP_PX
    if (moved) return

    // Real text-drag for copy is filtered by movement (slop) above — do NOT
    // skip pick just because a selection exists. Skipping made the first click
    // only clear an I-beam/selection (cursor:text surfaces), requiring a
    // second click to actually pick.
    const sel = win.getSelection()
    if (sel && !sel.isCollapsed) {
      try {
        sel.removeAllRanges()
      } catch {
        // ignore
      }
    }

    onPick()
  }

  /** Only the Window object losing focus (alt-tab / other app), not input blur. */
  const onWindowBlur = (ev: FocusEvent): void => {
    if (ev.target !== win) return
    cleanup()
  }

  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') cleanup()
  }

  win.addEventListener('mouseup', onUp, true)
  win.addEventListener('blur', onWindowBlur)
  doc.addEventListener('visibilitychange', onVisibility, true)
}

/**
 * React onMouseDown helper: stopPropagation on nested regions, schedule pick.
 * Does not preventDefault. The deferred `onPick` receives no event — capture
 * ids/hints in the closure (React synthetic events are invalid after the tick).
 */
export function handleClickPickMouseDown(
  event: ReactMouseEvent,
  onPick: () => void,
  options?: { stopPropagation?: boolean }
): void {
  if (event.button !== 0) return
  if (options?.stopPropagation !== false) {
    event.stopPropagation()
  }
  const snap: ClickPickPointer = {
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY
  }
  scheduleClickPick(snap, onPick)
}
