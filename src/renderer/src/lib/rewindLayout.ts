/** Vertical fisheye + Dock-style magnification for the rewind rail. */

export const REWIND_PAD = 10
export const DOCK_RADIUS = 2.6
/**
 * Label plates are ~16px tall. In a very long conversation the magnified cluster
 * only spreads a few px per slot, so names grow outward from the hovered tick
 * while they still clear this pitch and stop there: every tick still magnifies,
 * but the cluster is named contiguously instead of overlapping into a smear.
 */
const LABEL_PITCH = 18

export type RewindTickLayout = {
  index: number
  /** Center Y inside the rail, px. */
  y: number
  tickW: number
  tickH: number
  /** 1 at the focus, falling off toward the ends. */
  tickOpacity: number
  labelOpacity: number
  labelScale: number
}

function gaussian(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma))
}

/** macOS Dock-like cosine falloff in index space. 1 at center, 0 at radius. */
export function dockMagnify(index: number, hover: number | null, radius = DOCK_RADIUS): number {
  if (hover == null || !Number.isFinite(hover)) return 0
  const distance = Math.abs(index - hover)
  if (distance >= radius) return 0
  const t = (distance / radius) * (Math.PI / 2)
  return Math.cos(t) ** 2
}

/**
 * Slot spacing is solved in px, not in relative weights: the lens keeps exactly
 * FOCUS_SLOT so its label always fits, and the far field takes whatever pitch
 * makes the rail add up to its fixed height.
 */
const FOCUS_SLOT = 20
/** Floor for the far field once even hairlines stop fitting. */
const MIN_SLOT = 1.2
/** Spread of the space bulge, matched to DOCK_RADIUS so the slots that gain
 *  room are the same slots that magnify — a wider bulge just reads as empty. */
const SLOT_SIGMA = 2.4
/** Under this many turns the rail never squeezes: hover only magnifies. */
export const FISHEYE_MIN_TURNS = 10

export function rewindSlotWeights(
  count: number,
  focus: number,
  innerHeight: number,
  awake = true
): number[] {
  if (count <= 0) return []
  if (count === 1) return [innerHeight]
  // At rest the current tick is only a highlight — no empty padding around it.
  if (!awake || count <= FISHEYE_MIN_TURNS) return new Array<number>(count).fill(1)

  const boosts: number[] = []
  let spread = 0
  for (let i = 0; i < count; i++) {
    const boost = gaussian(i - focus, SLOT_SIGMA)
    boosts.push(boost)
    spread += boost
  }
  // Too few slots outside the bulge to solve against.
  if (count - spread <= 1) return new Array<number>(count).fill(1)

  /*
   * count * base + (FOCUS_SLOT - base) * spread = innerHeight, solved for base.
   * An answer at or above FOCUS_SLOT means everything fits without a fisheye,
   * so the clamp lands on even spacing; a negative one means the far field is
   * out of room and the pitch bottoms out at a hairline.
   */
  const base = Math.min(
    FOCUS_SLOT,
    Math.max(MIN_SLOT, (innerHeight - FOCUS_SLOT * spread) / (count - spread))
  )
  return boosts.map((boost) => base + (FOCUS_SLOT - base) * boost)
}

export function rewindCenters(weights: number[], height: number, pad = REWIND_PAD): number[] {
  const inner = Math.max(1, height - pad * 2)
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return weights.map((_, i) => pad + ((i + 0.5) / Math.max(1, weights.length)) * inner)
  const centers: number[] = []
  let acc = 0
  for (const weight of weights) {
    centers.push(pad + ((acc + weight / 2) / total) * inner)
    acc += weight
  }
  return centers
}

/** Fractional index of the tick nearest `y` (for pointer tracking). */
export function rewindIndexAtY(y: number, centers: number[]): number | null {
  if (centers.length === 0) return null
  if (centers.length === 1) return 0
  if (y <= centers[0]!) return 0
  const last = centers.length - 1
  if (y >= centers[last]!) return last
  for (let i = 0; i < last; i++) {
    const a = centers[i]!
    const b = centers[i + 1]!
    if (y <= b) {
      const span = b - a
      return span <= 0 ? i : i + (y - a) / span
    }
  }
  return last
}

export function layoutRewindRail(options: {
  count: number
  height: number
  focus: number
  hover: number | null
}): RewindTickLayout[] {
  const count = options.count
  if (count <= 0 || options.height <= 0) return []
  const inner = Math.max(1, options.height - REWIND_PAD * 2)
  const focus = Math.min(count - 1, Math.max(0, options.focus))
  const weights = rewindSlotWeights(count, focus, inner, options.hover != null)
  const centers = rewindCenters(weights, options.height)
  const mags: number[] = []
  for (let i = 0; i < count; i++) mags.push(dockMagnify(i, options.hover))

  const labels = new Array<number>(count).fill(0)
  if (options.hover != null) {
    const peak = Math.min(count - 1, Math.max(0, Math.round(options.hover)))
    labels[peak] = mags[peak]!
    let above = centers[peak]!
    for (let i = peak - 1; i >= 0 && mags[i]! > 0; i--) {
      if (above - centers[i]! < LABEL_PITCH) break
      labels[i] = mags[i]!
      above = centers[i]!
    }
    let below = centers[peak]!
    for (let i = peak + 1; i < count && mags[i]! > 0; i++) {
      if (centers[i]! - below < LABEL_PITCH) break
      labels[i] = mags[i]!
      below = centers[i]!
    }
  }

  const fadeSigma = Math.max(count * 0.22, 4)
  const items: RewindTickLayout[] = []
  for (let i = 0; i < count; i++) {
    const mag = mags[i]!
    items.push({
      index: i,
      y: centers[i]!,
      tickW: 4 + mag * 24,
      tickH: 1 + mag * 2.5,
      tickOpacity: 0.12 + 0.4 * gaussian(i - focus, fadeSigma),
      labelOpacity: labels[i]!,
      labelScale: 0.86 + mag * 0.18
    })
  }
  return items
}
