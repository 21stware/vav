import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import sharp from 'sharp'

/** Keep in sync with `src/shared/surfacePattern.ts`. */
export const SURFACE_PATTERN_FILENAME = 'surface-pattern.png'
const MAX_EDGE = 192
const MAX_BYTES = 12 * 1024 * 1024
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.svg'])

function cssTileSize(width: number, height: number): string {
  return `${Math.max(1, Math.round(width))}px ${Math.max(1, Math.round(height))}px`
}

export type ImportedSurfacePattern = {
  ok: true
  width: number
  height: number
  size: string
}

export type ImportSurfacePatternResult =
  | ImportedSurfacePattern
  | { ok: false; reason: 'no-alpha' | 'invalid' }

export function surfacePatternFilePath(userDataPath: string): string {
  return join(userDataPath, SURFACE_PATTERN_FILENAME)
}

/**
 * Copy a user image into `destPath` as a black + original-alpha PNG tile.
 * Only the transparency channel is kept (RGB is discarded). Aspect is
 * preserved. Opaque images are rejected — we do not invent a luminance mask.
 */
export async function importSurfacePattern(
  filePath: string,
  destPath: string
): Promise<ImportSurfacePatternResult> {
  const ext = extname(filePath).toLowerCase()
  if (!RASTER.has(ext)) return { ok: false, reason: 'invalid' }
  try {
    if (statSync(filePath).size > MAX_BYTES) return { ok: false, reason: 'invalid' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  try {
    const input = sharp(filePath, ext === '.svg' ? { density: 192 } : undefined).rotate()
    const meta = await input.metadata()
    if (!meta.width || !meta.height) return { ok: false, reason: 'invalid' }

    const { data, info } = await input
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels < 4 || info.width < 1 || info.height < 1) {
      return { ok: false, reason: 'invalid' }
    }
    if (!hasUsableAlpha(data)) return { ok: false, reason: 'no-alpha' }

    // Shape = alpha only. Black RGB matches the built-in tiles; CSS dyes with --accent.
    flattenRgbToBlack(data)

    const png = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 }
    })
      .png()
      .toBuffer()

    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, png)
    return {
      ok: true,
      width: info.width,
      height: info.height,
      size: cssTileSize(info.width, info.height)
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/** Persist an already-encoded PNG (legacy data-URL migrate). */
export function writeSurfacePatternPng(
  png: Buffer,
  destPath: string
): ImportedSurfacePattern | null {
  if (!isPng(png)) return null
  const size = pngSize(png)
  if (!size) return null
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, png)
  return { ok: true, ...size, size: cssTileSize(size.width, size.height) }
}

function isPng(png: Buffer): boolean {
  return (
    png.length >= 8 &&
    png[0] === 0x89 &&
    png[1] === 0x50 &&
    png[2] === 0x4e &&
    png[3] === 0x47 &&
    png[4] === 0x0d &&
    png[5] === 0x0a &&
    png[6] === 0x1a &&
    png[7] === 0x0a
  )
}

function pngSize(png: Buffer): { width: number; height: number } | null {
  // IHDR starts at byte 16: width / height as big-endian u32.
  if (png.length < 24) return null
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null
  return { width, height }
}

function hasUsableAlpha(data: Buffer): boolean {
  let min = 255
  let max = 0
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]!
    if (a < min) min = a
    if (a > max) max = a
    if (min < 8 && max > 248) return true
  }
  // Need both some ink and some clear — a flat opaque or empty plate is not a tile.
  return min < 240 && max > 16 && max - min >= 24
}

function flattenRgbToBlack(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
  }
}
