export type Rect = { x: number; y: number; width: number; height: number }

/** Cascade an overlay to the last clip's origin, clamped to the work area. */
export function overlayCascadeOrigin(
  area: Rect,
  lastBounds: { x: number; y: number } | null,
  size: { width: number; height: number },
  step = 28
): { x?: number; y?: number } {
  if (!lastBounds) return {}
  let x = lastBounds.x + step
  let y = lastBounds.y + step
  if (x + size.width > area.x + area.width) x = area.x + Math.max(0, area.width - size.width)
  if (y + size.height > area.y + area.height) y = area.y + Math.max(0, area.height - size.height)
  return { x, y }
}

/** Park a companion session on the right edge of a desktop work area. */
export function placeDetachedBounds(
  area: Rect,
  stored: { width?: number; height?: number } | null | undefined,
  cascade: number,
  minWidth: number
): Rect {
  const width = Math.min(stored?.width ?? minWidth, area.width - 40)
  const height = Math.min(stored?.height ?? 760, area.height - 60)
  const step = (cascade % 5) * 26
  return {
    width,
    height,
    x: area.x + area.width - width - 28 - step,
    y: area.y + Math.max(0, Math.round((area.height - height) / 2) - 20) + step
  }
}
