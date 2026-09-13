/**
 * Reflow-free text measurement for the mention box, powered by
 * `@chenglou/pretext`.
 *
 * The one place pretext earns its keep here is anchoring the suggestion popover
 * to the caret. The classic way to find a caret's pixel position inside a
 * `<textarea>` is a mirror `<div>` + `getBoundingClientRect()` on a marker span
 * — a synchronous layout/reflow on every keystroke. pretext computes the same
 * geometry as pure arithmetic over canvas-measured widths, touching no DOM.
 *
 * NOTE on accuracy: pretext's own docs flag `system-ui` / `-apple-system`
 * (this app's UI stack) as *unsafe for exact `layout()` accuracy on macOS*.
 * That is why pretext is used only for popover placement (a few px / one line
 * off is invisible) and NOT as the source of truth for text↔caret alignment,
 * which stays with the native textarea + a CSS mirror. See MentionBox.tsx.
 */
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'

export type TextMetrics = {
  /** Canvas `font` shorthand, e.g. `400 13.5px -apple-system, …`. */
  font: string
  /** letter-spacing in CSS px (0 when `normal`). */
  letterSpacing: number
  /** Resolved line-height in px. */
  lineHeight: number
  /** Content-box width available for text, in px. */
  maxWidth: number
  /** Left/top content-box insets, in px (padding + border). */
  padLeft: number
  padTop: number
}

function px(value: string, fallback = 0): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/** Read the metrics pretext needs from a live textarea's computed style. */
export function readMetrics(el: HTMLTextAreaElement): TextMetrics {
  const cs = getComputedStyle(el)
  const fontSize = px(cs.fontSize, 14)
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const letterSpacing = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing, 0)
  const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.2 : px(cs.lineHeight, fontSize * 1.2)
  const padLeft = px(cs.paddingLeft) + px(cs.borderLeftWidth)
  const padTop = px(cs.paddingTop) + px(cs.borderTopWidth)
  // clientWidth already excludes borders + scrollbar; strip padding for content.
  const maxWidth = Math.max(1, el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight))
  return { font, letterSpacing, lineHeight, maxWidth, padLeft, padTop }
}

export type CaretPoint = {
  /** X of the caret relative to the textarea's border box. */
  x: number
  /** Y of the caret's line top, relative to the textarea's border box. */
  y: number
  lineHeight: number
}

/**
 * Caret pixel position for the popover. Measures the text *before* the caret
 * with pretext (pre-wrap, so tabs/newlines/spaces count). The last measured
 * line's width is the caret X; the line count gives the caret Y.
 *
 * Returns `null` if pretext throws (e.g. missing `Intl.Segmenter`) so callers
 * fall back to box-anchored placement.
 */
export function caretPoint(
  textBeforeCaret: string,
  metrics: TextMetrics,
  scroll: { left: number; top: number }
): CaretPoint | null {
  try {
    const prepared = prepareWithSegments(textBeforeCaret, metrics.font, {
      whiteSpace: 'pre-wrap',
      letterSpacing: metrics.letterSpacing
    })
    const { lines, lineCount } = layoutWithLines(prepared, metrics.maxWidth, metrics.lineHeight)
    const last = lines[lines.length - 1]
    const x = last ? last.width : 0
    // A trailing hard newline yields an extra (empty) line the walker may not
    // emit; derive Y from lineCount, clamped to at least one line.
    const rows = Math.max(1, lineCount)
    const y = (rows - 1) * metrics.lineHeight
    return {
      x: metrics.padLeft + x - scroll.left,
      y: metrics.padTop + y - scroll.top,
      lineHeight: metrics.lineHeight
    }
  } catch {
    return null
  }
}
