import type { CropRect, ScreenshotMark } from '@shared/screenshotDraw'
import { paintMarks } from './screenshotPaint'

const MAX_EXPORT_EDGE = 2560

/** Flatten crop + marks to PNG base64 (no data-URL prefix). Caps the long edge. */
export function exportAnnotatedPng(
  image: HTMLImageElement,
  crop: CropRect,
  marks: ScreenshotMark[],
  displayWidth: number,
  displayHeight: number
): string {
  const scaleX = image.naturalWidth / Math.max(1, displayWidth)
  const scaleY = image.naturalHeight / Math.max(1, displayHeight)
  const srcW = Math.max(1, crop.w * scaleX)
  const srcH = Math.max(1, crop.h * scaleY)
  const long = Math.max(srcW, srcH)
  const outScale = long > MAX_EXPORT_EDGE ? MAX_EXPORT_EDGE / long : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(srcW * outScale))
  canvas.height = Math.max(1, Math.round(srcH * outScale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const cssToOut = outScale * scaleX
  ctx.setTransform(cssToOut, 0, 0, outScale * scaleY, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    srcW,
    srcH,
    0,
    0,
    crop.w,
    crop.h
  )
  paintMarks(ctx, marks)
  const url = canvas.toDataURL('image/png')
  const comma = url.indexOf(',')
  return comma >= 0 ? url.slice(comma + 1) : ''
}
