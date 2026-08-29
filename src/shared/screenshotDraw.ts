/**
 * Geometry + canvas paint for the screenshot annotator.
 *
 * Interaction model follows the mature Electron screenshot plugins
 * (nashaofu/screenshots): drag a crop, then draw rect / ellipse / arrow /
 * line / text on that crop. Coordinates are CSS pixels in crop space.
 */

export type ScreenshotTool = 'move' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text'

export type ScreenshotMark =
  | {
      id: string
      kind: 'rect' | 'ellipse' | 'arrow' | 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      width: number
    }
  | {
      id: string
      kind: 'text'
      x: number
      y: number
      text: string
      color: string
      fontSize: number
    }

export type CropRect = { x: number; y: number; w: number; h: number }

export const SCREENSHOT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#f8fafc', '#111827'] as const

export const SCREENSHOT_WIDTHS = [2, 4, 6] as const

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): CropRect {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

export function clampCrop(crop: CropRect, maxW: number, maxH: number): CropRect {
  const x = Math.max(0, Math.min(crop.x, maxW))
  const y = Math.max(0, Math.min(crop.y, maxH))
  const w = Math.max(0, Math.min(crop.w, maxW - x))
  const h = Math.max(0, Math.min(crop.h, maxH - y))
  return { x, y, w, h }
}

export function cropIsUsable(crop: CropRect, min = 8): boolean {
  return crop.w >= min && crop.h >= min
}

/** One pointerdown, for manual double-click detection. */
export type PointerDownSample = { t: number; x: number; y: number }

/** macOS default double-click interval is ~500ms; radius keeps drags out. */
export const DOUBLE_CLICK_MS = 500
export const DOUBLE_CLICK_RADIUS = 8

/**
 * The Pointer Events spec fixes `pointerdown.detail` at 0, so a real
 * double-click never arrives with `detail >= 2` — it must be reconstructed
 * from consecutive pointerdowns (same spot, within the OS interval).
 */
export function isDoubleClickPointerDown(
  prev: PointerDownSample | null,
  next: PointerDownSample
): boolean {
  if (!prev) return false
  if (next.t - prev.t > DOUBLE_CLICK_MS) return false
  return (
    Math.abs(next.x - prev.x) <= DOUBLE_CLICK_RADIUS &&
    Math.abs(next.y - prev.y) <= DOUBLE_CLICK_RADIUS
  )
}

export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type CropHandle = (typeof CROP_HANDLES)[number]
export type CropHit = CropHandle | 'move' | 'inside'

const HANDLE_PAD = 8
const EDGE_PAD = 10
const DRAW_INSIDE_MIN = 40

export function moveCrop(
  origin: CropRect,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number
): CropRect {
  return {
    x: Math.max(0, Math.min(origin.x + dx, Math.max(0, maxW - origin.w))),
    y: Math.max(0, Math.min(origin.y + dy, Math.max(0, maxH - origin.h))),
    w: origin.w,
    h: origin.h
  }
}

export function resizeCrop(
  origin: CropRect,
  handle: CropHandle,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  min = 8
): CropRect {
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.w
  let bottom = origin.y + origin.h
  if (handle.includes('w')) left = Math.max(0, Math.min(x, right - min))
  if (handle.includes('e')) right = Math.min(maxW, Math.max(x, left + min))
  if (handle.includes('n')) top = Math.max(0, Math.min(y, bottom - min))
  if (handle.includes('s')) bottom = Math.min(maxH, Math.max(y, top + min))
  return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, maxW, maxH)
}

function nearEdge(crop: CropRect, x: number, y: number, pad: number): boolean {
  const left = x - crop.x
  const top = y - crop.y
  const right = crop.x + crop.w - x
  const bottom = crop.y + crop.h - y
  return Math.min(left, top, right, bottom) <= pad
}

export function hitCrop(
  crop: CropRect,
  x: number,
  y: number,
  options: { handlePad?: number; edgePad?: number; interior?: 'move' | 'inside' } = {}
): CropHit | null {
  const handlePad = options.handlePad ?? HANDLE_PAD
  const edgePad = options.edgePad ?? EDGE_PAD
  const interior = options.interior ?? 'move'
  const points: { id: CropHandle; hx: number; hy: number }[] = [
    { id: 'nw', hx: crop.x, hy: crop.y },
    { id: 'n', hx: crop.x + crop.w / 2, hy: crop.y },
    { id: 'ne', hx: crop.x + crop.w, hy: crop.y },
    { id: 'e', hx: crop.x + crop.w, hy: crop.y + crop.h / 2 },
    { id: 'se', hx: crop.x + crop.w, hy: crop.y + crop.h },
    { id: 's', hx: crop.x + crop.w / 2, hy: crop.y + crop.h },
    { id: 'sw', hx: crop.x, hy: crop.y + crop.h },
    { id: 'w', hx: crop.x, hy: crop.y + crop.h / 2 }
  ]
  for (const point of points) {
    if (Math.abs(x - point.hx) <= handlePad && Math.abs(y - point.hy) <= handlePad) {
      return point.id
    }
  }
  if (x < crop.x || y < crop.y || x > crop.x + crop.w || y > crop.y + crop.h) return null
  if (interior === 'inside') {
    const canDrawInside = crop.w > DRAW_INSIDE_MIN && crop.h > DRAW_INSIDE_MIN
    if (canDrawInside && !nearEdge(crop, x, y, edgePad)) return 'inside'
  }
  return 'move'
}

export function cropCursor(hit: CropHit | null): string {
  switch (hit) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'move':
      return 'move'
    default:
      return ''
  }
}

export type MarkResizeHandle = CropHandle | 'start' | 'end'
export type MarkHit = MarkResizeHandle | 'move'

export function textBounds(mark: Extract<ScreenshotMark, { kind: 'text' }>): CropRect {
  const lines = mark.text.split('\n')
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 1)
  return {
    x: mark.x,
    y: mark.y,
    w: Math.max(mark.fontSize, widest * mark.fontSize * 0.62),
    h: Math.max(mark.fontSize, lines.length * mark.fontSize * 1.28)
  }
}

export function markBounds(mark: ScreenshotMark): CropRect {
  if (mark.kind === 'text') return textBounds(mark)
  return normalizeRect(mark.x1, mark.y1, mark.x2, mark.y2)
}

export function markHandlePoints(
  mark: ScreenshotMark
): { id: MarkResizeHandle; x: number; y: number }[] {
  if (mark.kind === 'line' || mark.kind === 'arrow') {
    return [
      { id: 'start', x: mark.x1, y: mark.y1 },
      { id: 'end', x: mark.x2, y: mark.y2 }
    ]
  }
  const box = markBounds(mark)
  return [
    { id: 'nw', x: box.x, y: box.y },
    { id: 'n', x: box.x + box.w / 2, y: box.y },
    { id: 'ne', x: box.x + box.w, y: box.y },
    { id: 'e', x: box.x + box.w, y: box.y + box.h / 2 },
    { id: 'se', x: box.x + box.w, y: box.y + box.h },
    { id: 's', x: box.x + box.w / 2, y: box.y + box.h },
    { id: 'sw', x: box.x, y: box.y + box.h },
    { id: 'w', x: box.x, y: box.y + box.h / 2 }
  ]
}

function pointNearSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pad: number
): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1) return Math.hypot(x - x1, y - y1) <= pad
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= pad
}

export function hitMark(mark: ScreenshotMark, x: number, y: number, pad = 8): MarkHit | null {
  const handlePad = pad + (mark.kind === 'text' ? 0 : mark.kind === 'rect' || mark.kind === 'ellipse' ? mark.width / 2 : mark.width)
  for (const point of markHandlePoints(mark)) {
    if (Math.abs(x - point.x) <= handlePad && Math.abs(y - point.y) <= handlePad) {
      return point.id
    }
  }
  if (mark.kind === 'line' || mark.kind === 'arrow') {
    return pointNearSegment(x, y, mark.x1, mark.y1, mark.x2, mark.y2, pad + mark.width) ? 'move' : null
  }
  const box = markBounds(mark)
  const inset = Math.max(pad, mark.kind === 'text' ? 0 : mark.width)
  if (
    x >= box.x - inset &&
    y >= box.y - inset &&
    x <= box.x + box.w + inset &&
    y <= box.y + box.h + inset
  ) {
    return 'move'
  }
  return null
}

export function hitTopMark(
  marks: ScreenshotMark[],
  x: number,
  y: number,
  pad = 8
): { mark: ScreenshotMark; hit: MarkHit } | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]
    if (!mark) continue
    const hit = hitMark(mark, x, y, pad)
    if (hit) return { mark, hit }
  }
  return null
}

export function moveMark(
  mark: ScreenshotMark,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number
): ScreenshotMark {
  const box = markBounds(mark)
  const ndx = Math.max(-box.x, Math.min(dx, maxW - (box.x + box.w)))
  const ndy = Math.max(-box.y, Math.min(dy, maxH - (box.y + box.h)))
  if (mark.kind === 'text') return { ...mark, x: mark.x + ndx, y: mark.y + ndy }
  return {
    ...mark,
    x1: mark.x1 + ndx,
    y1: mark.y1 + ndy,
    x2: mark.x2 + ndx,
    y2: mark.y2 + ndy
  }
}

export function resizeMark(
  mark: ScreenshotMark,
  handle: MarkResizeHandle,
  x: number,
  y: number,
  maxW: number,
  maxH: number
): ScreenshotMark {
  const px = Math.max(0, Math.min(x, maxW))
  const py = Math.max(0, Math.min(y, maxH))
  if (mark.kind === 'line' || mark.kind === 'arrow') {
    if (handle === 'start') return { ...mark, x1: px, y1: py }
    if (handle === 'end') return { ...mark, x2: px, y2: py }
    return mark
  }
  if (mark.kind === 'text') {
    if (handle === 'start' || handle === 'end') return mark
    const box = textBounds(mark)
    const next = resizeCrop(box, handle, px, py, maxW, maxH, 12)
    const scale = next.h / Math.max(1, box.h)
    return {
      ...mark,
      x: next.x,
      y: next.y,
      fontSize: Math.max(10, Math.round(mark.fontSize * scale))
    }
  }
  if (handle === 'start' || handle === 'end') return mark
  const box = normalizeRect(mark.x1, mark.y1, mark.x2, mark.y2)
  const next = resizeCrop(box, handle, px, py, maxW, maxH, 4)
  return { ...mark, x1: next.x, y1: next.y, x2: next.x + next.w, y2: next.y + next.h }
}

export function markCursor(hit: MarkHit | null): string {
  if (hit === 'start' || hit === 'end') return 'grab'
  return cropCursor(hit === 'move' ? 'move' : hit)
}

/** Arrow head as two wing points + tip. Size scales with stroke, capped. */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: number
): { left: { x: number; y: number }; right: { x: number; y: number }; tip: { x: number; y: number } } {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const size = Math.min(18, Math.max(10, stroke * 3.2))
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  return {
    tip: { x: x2, y: y2 },
    left: { x: x2 - ux * size + px * size * 0.42, y: y2 - uy * size + py * size * 0.42 },
    right: { x: x2 - ux * size - px * size * 0.42, y: y2 - uy * size - py * size * 0.42 }
  }
}

