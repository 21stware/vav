/**
 * Pinch-zoom + pan inside in-chat diagram viewports (Mermaid, Vega-Lite,
 * Graphviz, ERD). Same contract as an inline Google Map: the page keeps
 * scrolling until the user holds ⌘ (Ctrl on Windows).
 *
 * - No modifier: wheel scrolls the transcript (never preventDefault).
 * - ⌘ + pinch / Ctrl + wheel: cursor-anchored zoom.
 * - ⌘ + two-finger swipe: pan. Drag-pan while ⌘ is held, or once off-identity.
 * - Reset (bottom-right) returns to identity (CSS-fitted, top-left).
 */

import { tt } from '../i18n/useT'
import { IS_MAC } from './platform'
import {
  IDENTITY_VIEW,
  isIdentityView,
  zoomViewAtClient,
  type ViewportView
} from './diagramViewportCamera'

export {
  clampDiagramZoom,
  IDENTITY_VIEW,
  isIdentityView,
  zoomViewAtClient,
  type ViewportView
} from './diagramViewportCamera'

const MAX_WHEEL_STEP = 1.5
const PINCH_SENSITIVITY = 0.014
const WHEEL_ZOOM_SENSITIVITY = 0.005

function wheelPx(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta
}

const HINT_KEY_TOKEN = '\u0001'

function modifierHeld(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey
}

/** Chromium reports trackpad pinch as wheel + ctrlKey. */
function isPinchWheel(e: WheelEvent): boolean {
  return e.ctrlKey
}

type Controller = {
  dispose: () => void
}

const attached = new WeakMap<HTMLElement, Controller>()

function contentHost(viewport: HTMLElement): HTMLElement | null {
  return viewport.querySelector<HTMLElement>(':scope > .md-diagram, :scope > .md-mermaid')
}

function resetButton(viewport: HTMLElement): HTMLButtonElement | null {
  return viewport.querySelector<HTMLButtonElement>(':scope > .md-diagram-zoom-reset')
}

function hintEl(viewport: HTMLElement): HTMLElement | null {
  return viewport.querySelector<HTMLElement>(':scope > .md-diagram-viewport-hint')
}

function ensureResetButton(viewport: HTMLElement): HTMLButtonElement {
  let btn = resetButton(viewport)
  if (btn) return btn
  btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'md-diagram-zoom-reset'
  viewport.appendChild(btn)
  return btn
}

function fillHint(el: HTMLElement): void {
  const keyLabel = IS_MAC ? '⌘' : 'Ctrl'
  const labeled = tt('diagram.viewportHint', { key: HINT_KEY_TOKEN })
  const parts = labeled.split(HINT_KEY_TOKEN)
  el.replaceChildren()
  if (parts[0]) el.append(parts[0])
  const kbd = document.createElement('kbd')
  kbd.className = 'md-diagram-viewport-key'
  kbd.textContent = keyLabel
  el.append(kbd)
  if (parts[1]) el.append(parts[1])
}

function ensureHint(viewport: HTMLElement): HTMLElement {
  let el = hintEl(viewport)
  if (!el) {
    el = document.createElement('p')
    el.className = 'md-diagram-viewport-hint'
    viewport.appendChild(el)
  }
  fillHint(el)
  return el
}

function labelReset(btn: HTMLButtonElement): void {
  const label = tt('diagram.viewportReset')
  btn.textContent = label
  btn.title = tt('canvas.zoomReset')
  btn.setAttribute('aria-label', tt('canvas.zoomReset'))
}

/**
 * Wrap a live diagram host that was painted without a viewport (legacy HTML).
 */
export function ensureDiagramViewport(host: HTMLElement): HTMLElement {
  const existing = host.closest<HTMLElement>('.md-diagram-viewport')
  if (existing) {
    ensureResetButton(existing)
    ensureHint(existing)
    return existing
  }
  const parent = host.parentElement
  if (!parent) return host
  const vp = document.createElement('div')
  vp.className = 'md-diagram-viewport'
  parent.insertBefore(vp, host)
  vp.appendChild(host)
  ensureResetButton(vp)
  ensureHint(vp)
  return vp
}

function attachViewport(viewport: HTMLElement): void {
  if (attached.has(viewport)) return
  const content = contentHost(viewport)
  if (!content) return

  const btn = ensureResetButton(viewport)
  ensureHint(viewport)
  labelReset(btn)

  const view: ViewportView = { ...IDENTITY_VIEW }
  let hostRect: DOMRect | null = null
  let lastWheelAt = 0
  let panHintTimer: number | null = null
  let modHeld = false
  let drag: { pointerId: number; lastX: number; lastY: number } | null = null

  const paint = (): void => {
    const off = !isIdentityView(view)
    // Identity must not leave a transform on the host — a compositing layer
    // here punches through the card's border-radius clip (square corners).
    if (off) {
      content.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`
      content.style.transformOrigin = '0 0'
    } else {
      content.style.removeProperty('transform')
      content.style.removeProperty('transform-origin')
    }
    viewport.dataset.offFit = off ? 'true' : 'false'
    viewport.dataset.panning = drag ? 'true' : 'false'
    viewport.dataset.mod = modHeld ? 'true' : 'false'
  }

  const setModHeld = (next: boolean): void => {
    if (modHeld === next) return
    modHeld = next
    viewport.dataset.mod = next ? 'true' : 'false'
  }

  const setPanHint = (on: boolean): void => {
    if (panHintTimer != null) {
      window.clearTimeout(panHintTimer)
      panHintTimer = null
    }
    content.style.willChange = on ? 'transform' : 'auto'
  }

  const releasePanHintSoon = (): void => {
    if (panHintTimer != null) window.clearTimeout(panHintTimer)
    panHintTimer = window.setTimeout(() => {
      panHintTimer = null
      content.style.willChange = 'auto'
    }, 180)
  }

  const applyZoom = (e: WheelEvent): void => {
    setPanHint(false)
    if (!hostRect) hostRect = viewport.getBoundingClientRect()
    const dy = wheelPx(e.deltaY, e.deltaMode)
    const sensitivity = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY
    const step = Math.min(
      MAX_WHEEL_STEP,
      Math.max(1 / MAX_WHEEL_STEP, Math.exp(-dy * sensitivity))
    )
    const next = zoomViewAtClient(view, view.zoom * step, e.clientX, e.clientY, hostRect)
    view.tx = next.tx
    view.ty = next.ty
    view.zoom = next.zoom
    paint()
  }

  const applyPan = (dx: number, dy: number): void => {
    setPanHint(true)
    releasePanHintSoon()
    view.tx -= dx
    view.ty -= dy
    paint()
  }

  const reset = (): void => {
    view.tx = 0
    view.ty = 0
    view.zoom = 1
    setPanHint(false)
    paint()
  }

  const onWheel = (e: WheelEvent): void => {
    if (e.timeStamp - lastWheelAt > 220) hostRect = null
    lastWheelAt = e.timeStamp
    // Page scroll always wins unless the platform modifier is held.
    // Do not treat trackpad pinch (ctrlKey) as a capture — that ate scroll.
    if (!modifierHeld(e)) return

    e.preventDefault()
    e.stopPropagation()
    if (isPinchWheel(e) || !IS_MAC) {
      applyZoom(e)
      return
    }
    applyPan(wheelPx(e.deltaX, e.deltaMode), wheelPx(e.deltaY, e.deltaMode))
  }

  const onPointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement | null)?.closest?.('.md-diagram-zoom-reset')) return
    setModHeld(modifierHeld(e))
    const wantsPan =
      e.button === 1 || (e.button === 0 && (modHeld || !isIdentityView(view)))
    if (!wantsPan) return
    hostRect = null
    drag = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    setPanHint(true)
    try {
      viewport.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    e.preventDefault()
    paint()
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.lastX
    const dy = e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    view.tx += dx
    view.ty += dy
    paint()
  }

  const endDrag = (e: PointerEvent): void => {
    if (!drag || drag.pointerId !== e.pointerId) return
    drag = null
    setPanHint(false)
    paint()
  }

  const onResetClick = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    reset()
  }

  const onResetDown = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onModKey = (e: KeyboardEvent): void => {
    if (e.key === 'Meta' || e.key === 'Control') {
      setModHeld(e.type === 'keydown')
      return
    }
    setModHeld(modifierHeld(e))
  }

  const onWinBlur = (): void => setModHeld(false)

  viewport.addEventListener('wheel', onWheel, { passive: false })
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)
  btn.addEventListener('click', onResetClick)
  btn.addEventListener('mousedown', onResetDown)
  window.addEventListener('keydown', onModKey)
  window.addEventListener('keyup', onModKey)
  window.addEventListener('blur', onWinBlur)

  paint()

  attached.set(viewport, {
    dispose: () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('pointermove', onPointerMove)
      viewport.removeEventListener('pointerup', endDrag)
      viewport.removeEventListener('pointercancel', endDrag)
      btn.removeEventListener('click', onResetClick)
      btn.removeEventListener('mousedown', onResetDown)
      window.removeEventListener('keydown', onModKey)
      window.removeEventListener('keyup', onModKey)
      window.removeEventListener('blur', onWinBlur)
      if (panHintTimer != null) window.clearTimeout(panHintTimer)
      content.style.willChange = 'auto'
      attached.delete(viewport)
    }
  })
}

export function disposeDiagramViewportZoom(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.md-diagram-viewport').forEach((vp) => {
    attached.get(vp)?.dispose()
  })
}

/** Attach (or no-op) pinch/pan/reset on every diagram viewport under `root`. */
export function syncDiagramViewportZoom(root: HTMLElement): void {
  const hosts = root.querySelectorAll<HTMLElement>('.md-diagram, .md-mermaid')
  for (const host of hosts) {
    if (host.classList.contains('md-diagram-error') && !host.querySelector('svg')) continue
    const vp = ensureDiagramViewport(host)
    attachViewport(vp)
  }
}
