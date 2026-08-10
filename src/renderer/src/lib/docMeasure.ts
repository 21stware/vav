/**
 * Stable reading widths for document stages (DOCX / PDF / PPTX / MD).
 *
 * Pages keep a fixed size between `--*-measure-min` and `--*-measure`. They do
 * not shrink/grow with the preview pane — a narrower window scrolls
 * horizontally instead of reflowing the paper.
 */

const FALLBACK_DOC_PX = 860
const FALLBACK_DOC_MIN_PX = 720
const FALLBACK_SLIDE_PX = 1000
const FALLBACK_SLIDE_MIN_PX = 800

function readMeasure(el: Element | null, name: string, fallback: number): number {
  if (!el || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(el).getPropertyValue(name).trim()
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) && px >= 240 ? px : fallback
}

export function docMeasurePx(el: Element | null): number {
  return readMeasure(el, '--doc-measure', FALLBACK_DOC_PX)
}

export function docMeasureMinPx(el: Element | null): number {
  return readMeasure(el, '--doc-measure-min', FALLBACK_DOC_MIN_PX)
}

export function slideMeasurePx(el: Element | null): number {
  return readMeasure(el, '--slide-measure', FALLBACK_SLIDE_PX)
}

export function slideMeasureMinPx(el: Element | null): number {
  return readMeasure(el, '--slide-measure-min', FALLBACK_SLIDE_MIN_PX)
}

/**
 * Stable CSS width for a page/slide: prefer its natural size, clamped into
 * [min, max]. Never follows the host pane — callers scroll when the stage is
 * narrower than the result.
 */
export function stableContentWidth(
  natural: number,
  min: number,
  max: number
): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const base = natural > 40 ? natural : hi
  return Math.min(hi, Math.max(lo, base))
}

/** @deprecated Prefer {@link stableContentWidth} — kept for any residual call sites. */
export function fitWidthIn(hostWidth: number, gutter: number, measure: number): number {
  return Math.max(120, Math.min(hostWidth - gutter, measure))
}
