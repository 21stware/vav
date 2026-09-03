/**
 * Composer context-usage ring — a line around the 16px agent mark.
 *
 * The mark is a 16×16 plate with a 5px CSS radius. An outset of 2px
 * (the 20px path inside a 22px viewBox) grows that radius to 7px.
 * Each corner is one cubic with the circle κ (4/3 tan(π/8)) — the macOS
 * quarter-circle approximation — so the line eases through the corner
 * instead of a clipped rounded-rect segment.
 *
 * Inset keeps the 1.5px round-cap stroke inside the viewBox. Path starts
 * at 12 o'clock and walks clockwise.
 */

export const CONTEXT_RING_SIZE = 22
/** Keep in sync with `.agent-model-picker-progress` stroke-width. */
export const CONTEXT_RING_STROKE = 1.5
/** Half stroke + a sliver so the round cap never kisses the viewBox. */
export const CONTEXT_RING_INSET = CONTEXT_RING_STROKE / 2 + 0.25
/** 16px mark + 5px radius, outset by the ring's extra 2px. */
export const CONTEXT_RING_RADIUS = 7

/** 4/3 tan(π/8) — cubic approximation of a quarter circle. */
const CIRCLE_KAPPA = 0.5519150244935106

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

export function contextRingPath(options?: {
  size?: number
  stroke?: number
  inset?: number
  radius?: number
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
  const maxR = Math.min(right - left, bottom - top) / 2
  const radius = Math.min(options?.radius ?? CONTEXT_RING_RADIUS, maxR)
  const cx = (left + right) / 2
  const k = radius * CIRCLE_KAPPA

  const parts = [
    `M ${fmt(cx)} ${fmt(top)}`,
    `L ${fmt(right - radius)} ${fmt(top)}`,
    `C ${fmt(right - radius + k)} ${fmt(top)} ${fmt(right)} ${fmt(top + radius - k)} ${fmt(right)} ${fmt(top + radius)}`,
    `L ${fmt(right)} ${fmt(bottom - radius)}`,
    `C ${fmt(right)} ${fmt(bottom - radius + k)} ${fmt(right - radius + k)} ${fmt(bottom)} ${fmt(right - radius)} ${fmt(bottom)}`,
    `L ${fmt(left + radius)} ${fmt(bottom)}`,
    `C ${fmt(left + radius - k)} ${fmt(bottom)} ${fmt(left)} ${fmt(bottom - radius + k)} ${fmt(left)} ${fmt(bottom - radius)}`,
    `L ${fmt(left)} ${fmt(top + radius)}`,
    `C ${fmt(left)} ${fmt(top + radius - k)} ${fmt(left + radius - k)} ${fmt(top)} ${fmt(left + radius)} ${fmt(top)}`,
    `L ${fmt(cx)} ${fmt(top)}`
  ]

  if (close) parts.push('Z')
  return parts.join(' ')
}
