/**
 * Fit + zoom math for paged document stages (PDF / DOCX / PPTX).
 *
 * Contract:
 *  - Width is the fit axis. A document opens at the largest scale that shows a
 *    full page width, never past 100%. Taller-than-viewport content scrolls;
 *    shorter content is centred vertically by the stage.
 *  - Fit is also the zoom floor, so pinching out always lands exactly on fit —
 *    which is what re-arms auto-fit (the stage follows pane resizes again).
 *  - Pan is the scrollport's own scroll, so the page can never be dragged out
 *    of view the way an infinite canvas allows.
 */

/** Hard ceiling for manual zoom. */
export const DOC_ZOOM_MAX = 4
/** Auto-fit never upscales — a Letter page blown across a 5K pane reads as broken. */
export const DOC_FIT_MAX = 1
/** Land on fit (not 1.02× of it) when a pinch ends this close. */
export const DOC_FIT_SNAP = 0.03
/** Cap a single wheel notch so mouse wheels don't jump whole scales. */
const MAX_WHEEL_STEP = 1.5
/** Pinch deltas are tiny; mouse-wheel deltas are large. Separate sensitivities. */
const PINCH_SENSITIVITY = 0.014
const WHEEL_ZOOM_SENSITIVITY = 0.005

/** Normalize line/page wheel modes to pixels. */
export function wheelPx(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta
}

/** Content-box size of a scrollport — its padding is stage gutter, not page. */
export function stageUsableBox(stage: HTMLElement | null): { width: number; height: number } {
  if (!stage) return { width: 0, height: 0 }
  const style = getComputedStyle(stage)
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  return { width: stage.clientWidth - padX, height: stage.clientHeight - padY }
}

/** Content-box width of a scrollport — its padding is stage gutter, not page. */
export function stageUsableWidth(stage: HTMLElement | null): number {
  return stageUsableBox(stage).width
}

/** Largest scale that fits `natural` CSS px of content into `available` px. */
export function computeFitScale(
  available: number,
  natural: number,
  maxFit: number = DOC_FIT_MAX
): number {
  if (!(available > 0) || !(natural > 0)) return maxFit
  return Math.max(0.05, Math.min(maxFit, available / natural))
}

/**
 * Contain fit: the largest scale where *both* axes fit. Used for media, where a
 * portrait photo width-fitted would run off the bottom of the stage. Falls back
 * to width-only fit while the height is still unknown.
 */
export function computeContainFit(
  available: { width: number; height: number },
  natural: { width: number; height: number },
  maxFit: number = DOC_FIT_MAX
): number {
  const byWidth = computeFitScale(available.width, natural.width, maxFit)
  if (!(natural.height > 0) || !(available.height > 0)) return byWidth
  return Math.min(byWidth, computeFitScale(available.height, natural.height, maxFit))
}

export function clampDocScale(scale: number, fitScale: number): number {
  if (!Number.isFinite(scale)) return fitScale
  const floor = Math.min(fitScale, DOC_ZOOM_MAX)
  return Math.min(DOC_ZOOM_MAX, Math.max(floor, scale))
}

/**
 * Clamp, then snap near-fit scales exactly onto fit. `atFit` is what callers
 * use to decide whether the stage still tracks pane resizes.
 */
export function settleDocScale(
  scale: number,
  fitScale: number
): { scale: number; atFit: boolean } {
  const clamped = clampDocScale(scale, fitScale)
  if (fitScale > 0 && Math.abs(clamped - fitScale) <= fitScale * DOC_FIT_SNAP) {
    return { scale: fitScale, atFit: true }
  }
  return { scale: clamped, atFit: false }
}

/** Multiplier for one wheel/pinch event. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const dy = wheelPx(deltaY, deltaMode)
  const sensitivity = pinch ? PINCH_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY
  return Math.min(MAX_WHEEL_STEP, Math.max(1 / MAX_WHEEL_STEP, Math.exp(-dy * sensitivity)))
}

/**
 * New scroll offset on one axis that keeps the content point under `pointer`
 * pinned while the laid-out content grows from `from` to `to`.
 *
 * `from`/`to` are content box sizes, not scrollWidth: content narrower than the
 * viewport is centred by the stage, and that free margin has to be accounted
 * for or the page slides sideways under the cursor.
 */
export function axisAnchoredScroll(
  scroll: number,
  client: number,
  from: number,
  to: number,
  pointer: number
): number {
  if (!(from > 0) || !(to > 0) || !(client > 0)) return scroll
  const offsetFrom = Math.max(0, (client - from) / 2)
  const offsetTo = Math.max(0, (client - to) / 2)
  const ratio = (scroll + pointer - offsetFrom) / from
  const next = ratio * to + offsetTo - pointer
  const max = Math.max(0, to - client)
  return Math.min(max, Math.max(0, next))
}

/*
 * Text zoom is a different animal from page zoom: markdown, code and sheets
 * have no fixed page box, so "fit" means nothing there. Scaling them
 * geometrically would blur glyphs and freeze the measure, so instead the zoom
 * rides the font size and the content reflows — the same thing a browser's
 * ⌘+ does. 100% is the resting point, and there is no upscale cap because the
 * text stays vector-sharp at any size.
 */
export const TEXT_ZOOM_MIN = 0.7
export const TEXT_ZOOM_MAX = 2.6
/** One button press. */
export const TEXT_ZOOM_STEP = 1.1

export function settleTextZoom(scale: number): { scale: number; atFit: boolean } {
  if (!Number.isFinite(scale)) return { scale: 1, atFit: true }
  const clamped = Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, scale))
  if (Math.abs(clamped - 1) <= DOC_FIT_SNAP) return { scale: 1, atFit: true }
  return { scale: clamped, atFit: false }
}

export type ZoomAnchor = {
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
  fromWidth: number
  fromHeight: number
  toWidth: number
  toHeight: number
  /** Pointer position relative to the scrollport's top-left border box. */
  pointerX: number
  pointerY: number
}

export function anchoredScroll(a: ZoomAnchor): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: axisAnchoredScroll(
      a.scrollLeft,
      a.clientWidth,
      a.fromWidth,
      a.toWidth,
      a.pointerX
    ),
    scrollTop: axisAnchoredScroll(
      a.scrollTop,
      a.clientHeight,
      a.fromHeight,
      a.toHeight,
      a.pointerY
    )
  }
}
