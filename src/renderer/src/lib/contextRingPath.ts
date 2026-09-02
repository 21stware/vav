/**
 * Composer context-usage ring — a macOS continuous-corner cubic, not a
 * clipped rounded-rect border.
 *
 * Apple / Figma "corner smoothing" at 100%: two cubics per corner so the
 * line eases out of each side. Radius is a quarter of the box, which is
 * the largest value that still fits 100% smoothing — a full squircle,
 * no circular-arc remainder, no long flat that gets sheared off when the
 * stroke sits on the viewBox.
 *
 * Geometry lives in a `size × size` box and is inset so a round-cap stroke
 * of `stroke` stays inside the viewBox. Path starts at 12 o'clock and walks
 * clockwise.
 *
 * https://www.figma.com/blog/desperately-seeking-squircles/
 */

export const CONTEXT_RING_SIZE = 22
/** Keep in sync with `.agent-model-picker-progress` stroke-width. */
export const CONTEXT_RING_STROKE = 1.5
/** Half stroke + a sliver so the round cap never kisses the viewBox. */
export const CONTEXT_RING_INSET = CONTEXT_RING_STROKE / 2 + 0.25

type Corner = {
  a: number
  b: number
  c: number
  d: number
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Figma continuous-corner parameters at 100% smoothing. */
function cornerParams(radius: number): Corner {
  const p = 2 * radius
  const p3ToP4 = radius * Math.tan(toRad(22.5))
  const c = p3ToP4 * Math.cos(toRad(45))
  const d = c * Math.tan(toRad(45))
  const b = (p - c - d) / 3
  const a = 2 * b
  return { a, b, c, d }
}

export function contextRingPath(options?: {
  size?: number
  stroke?: number
  /** Override inset. Defaults to a stroke-safe margin. */
  inset?: number
  close?: boolean
}): string {
  const size = options?.size ?? CONTEXT_RING_SIZE
  const stroke = options?.stroke ?? CONTEXT_RING_STROKE
  const inset = options?.inset ?? stroke / 2 + 0.25
  const close = options?.close ?? false

  const left = inset
  const top = inset
  const right = size - inset
  const bottom = size - inset
  const radius = Math.min(right - left, bottom - top) / 4
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const { a, b, c, d } = cornerParams(radius)

  const parts = [
    `M ${fmt(cx)} ${fmt(top)}`,
    // top → right
    `C ${fmt(cx + a)} ${fmt(top)} ${fmt(cx + a + b)} ${fmt(top)} ${fmt(cx + a + b + c)} ${fmt(top + d)}`,
    `C ${fmt(right)} ${fmt(top + d + c)} ${fmt(right)} ${fmt(top + d + b + c)} ${fmt(right)} ${fmt(cy)}`,
    // right → bottom
    `C ${fmt(right)} ${fmt(cy + a)} ${fmt(right)} ${fmt(cy + a + b)} ${fmt(right - d)} ${fmt(cy + a + b + c)}`,
    `C ${fmt(right - d - c)} ${fmt(bottom)} ${fmt(right - d - b - c)} ${fmt(bottom)} ${fmt(cx)} ${fmt(bottom)}`,
    // bottom → left
    `C ${fmt(cx - a)} ${fmt(bottom)} ${fmt(cx - a - b)} ${fmt(bottom)} ${fmt(cx - a - b - c)} ${fmt(bottom - d)}`,
    `C ${fmt(left)} ${fmt(bottom - d - c)} ${fmt(left)} ${fmt(bottom - d - b - c)} ${fmt(left)} ${fmt(cy)}`,
    // left → top
    `C ${fmt(left)} ${fmt(cy - a)} ${fmt(left)} ${fmt(cy - a - b)} ${fmt(left + d)} ${fmt(cy - a - b - c)}`,
    `C ${fmt(left + d + c)} ${fmt(top)} ${fmt(left + d + b + c)} ${fmt(top)} ${fmt(cx)} ${fmt(top)}`
  ]

  if (close) parts.push('Z')
  return parts.join(' ')
}
