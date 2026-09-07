import {
  arrowHead,
  markBounds,
  markHandlePoints,
  normalizeRect,
  type ScreenshotMark
} from '@shared/screenshotDraw'

export function paintMark(
  ctx: CanvasRenderingContext2D,
  mark: ScreenshotMark,
  draft?: { x2: number; y2: number }
): void {
  if (mark.kind === 'text') {
    ctx.save()
    ctx.fillStyle = mark.color
    ctx.font = `600 ${mark.fontSize}px "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.textBaseline = 'top'
    const lines = mark.text.split('\n')
    const leading = mark.fontSize * 1.28
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i] ?? '', mark.x, mark.y + i * leading)
    }
    ctx.restore()
    return
  }

  const x2 = draft?.x2 ?? mark.x2
  const y2 = draft?.y2 ?? mark.y2
  ctx.save()
  ctx.strokeStyle = mark.color
  ctx.fillStyle = mark.color
  ctx.lineWidth = mark.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (mark.kind === 'rect') {
    const box = normalizeRect(mark.x1, mark.y1, x2, y2)
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1))
  } else if (mark.kind === 'ellipse') {
    const box = normalizeRect(mark.x1, mark.y1, x2, y2)
    ctx.beginPath()
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (mark.kind === 'line') {
    ctx.beginPath()
    ctx.moveTo(mark.x1, mark.y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  } else {
    const head = arrowHead(mark.x1, mark.y1, x2, y2, mark.width)
    const dx = x2 - mark.x1
    const dy = y2 - mark.y1
    const len = Math.hypot(dx, dy) || 1
    const inset = Math.min(14, Math.max(8, mark.width * 2.4))
    ctx.beginPath()
    ctx.moveTo(mark.x1, mark.y1)
    ctx.lineTo(x2 - (dx / len) * inset * 0.45, y2 - (dy / len) * inset * 0.45)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(head.tip.x, head.tip.y)
    ctx.lineTo(head.left.x, head.left.y)
    ctx.lineTo(head.right.x, head.right.y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

export function paintMarks(ctx: CanvasRenderingContext2D, marks: ScreenshotMark[]): void {
  for (const mark of marks) paintMark(ctx, mark)
}

export function paintMarkSelection(ctx: CanvasRenderingContext2D, mark: ScreenshotMark): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 1
  if (mark.kind !== 'line' && mark.kind !== 'arrow') {
    const box = markBounds(mark)
    ctx.setLineDash([4, 3])
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w), Math.max(0, box.h))
    ctx.setLineDash([])
  }
  for (const point of markHandlePoints(mark)) {
    ctx.fillRect(point.x - 3, point.y - 3, 6, 6)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)'
    ctx.strokeRect(point.x - 3.5, point.y - 3.5, 7, 7)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  }
  ctx.restore()
}
