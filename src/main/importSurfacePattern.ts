import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

/** Keep in sync with `src/shared/surfacePattern.ts`. */
export const SURFACE_PATTERN_FILENAME = 'surface-pattern.png'
const MAX_EDGE = 192
const MAX_BYTES = 12 * 1024 * 1024
const MAX_DECODE_EDGE = 4096
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.svg'])
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

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
 *
 * Do not import `sharp` from this module. It is a native addon whose platform
 * package is not shipped in the asar; electron-vite used to inline its JS, so
 * the main process threw on boot after electron-updater swapped the app.
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
    const file = readFileSync(filePath)
    if (isJpeg(file)) return { ok: false, reason: 'no-alpha' }

    const decoded = decodeRgba(file, filePath)
    if (!decoded) return { ok: false, reason: 'invalid' }

    const fitted = fitInside(decoded.data, decoded.width, decoded.height, MAX_EDGE)
    if (fitted.width < 1 || fitted.height < 1) return { ok: false, reason: 'invalid' }
    if (!hasUsableAlpha(fitted.data)) return { ok: false, reason: 'no-alpha' }

    // Shape = alpha only. Black RGB matches the built-in tiles; CSS dyes with --accent.
    flattenRgbToBlack(fitted.data)

    const png = encodePngRgba(fitted.data, fitted.width, fitted.height)
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, png)
    return {
      ok: true,
      width: fitted.width,
      height: fitted.height,
      size: cssTileSize(fitted.width, fitted.height)
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

function decodeRgba(file: Buffer, filePath: string): { data: Buffer; width: number; height: number } | null {
  if (isPng(file)) {
    const png = decodePngRgba(file)
    if (png) return png
  }
  return decodeWithNativeImage(filePath)
}

function decodeWithNativeImage(
  filePath: string
): { data: Buffer; width: number; height: number } | null {
  const nativeImage = loadNativeImage()
  if (!nativeImage) return null
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize(1)
  if (!width || !height) return null
  const bitmap = image.toBitmap({ scaleFactor: 1 })
  const expected = width * height * 4
  if (bitmap.length < expected) return null
  const data = Buffer.alloc(expected)
  for (let i = 0; i < expected; i += 4) {
    data[i] = bitmap[i + 2]!
    data[i + 1] = bitmap[i + 1]!
    data[i + 2] = bitmap[i]!
    data[i + 3] = bitmap[i + 3]!
  }
  return { data, width, height }
}

function loadNativeImage(): typeof import('electron').nativeImage | null {
  if (!process.versions.electron) return null
  try {
    const req = createRequire(import.meta.url)
    const electron = req('electron') as typeof import('electron') | string
    if (!electron || typeof electron === 'string' || !electron.nativeImage) return null
    return electron.nativeImage
  } catch {
    return null
  }
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

function isPng(png: Buffer): boolean {
  return png.length >= 8 && png.subarray(0, 8).equals(PNG_SIG)
}

function pngSize(png: Buffer): { width: number; height: number } | null {
  // IHDR starts at byte 16: width / height as big-endian u32.
  if (png.length < 24) return null
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1 || height < 1 || width > MAX_DECODE_EDGE || height > MAX_DECODE_EDGE) return null
  return { width, height }
}

function decodePngRgba(png: Buffer): { data: Buffer; width: number; height: number } | null {
  if (png.length < 33) return null
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  let plte: Buffer | null = null
  let trns: Buffer | null = null
  const idats: Buffer[] = []

  let offset = 8
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    if (offset + 12 + length > png.length) return null
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = png.readUInt32BE(offset + 8 + length)
    if ((crc32(png.subarray(offset + 4, offset + 8 + length)) >>> 0) !== expectedCrc) return null
    offset += 12 + length

    if (type === 'IHDR') {
      if (data.length < 13) return null
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (type === 'PLTE') {
      plte = Buffer.from(data)
    } else if (type === 'tRNS') {
      trns = Buffer.from(data)
    } else if (type === 'IDAT') {
      idats.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (
    width < 1 ||
    height < 1 ||
    width > MAX_DECODE_EDGE ||
    height > MAX_DECODE_EDGE ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    idats.length === 0
  ) {
    return null
  }

  const channels = pngChannels(colorType)
  if (!channels) return null
  if (colorType === 3 && (!plte || plte.length < 3 || plte.length % 3 !== 0)) return null

  let inflated: Buffer
  try {
    inflated = inflateSync(Buffer.concat(idats))
  } catch {
    return null
  }

  const stride = width * channels
  const rowBytes = 1 + stride
  if (inflated.length < rowBytes * height) return null

  const raw = Buffer.alloc(stride * height)
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes
    const filter = inflated[rowOff]!
    const src = inflated.subarray(rowOff + 1, rowOff + 1 + stride)
    const dest = raw.subarray(y * stride, (y + 1) * stride)
    if (!unfilterRow(filter, src, dest, prev, channels)) return null
    dest.copy(prev)
  }

  return { data: expandToRgba(raw, width, height, colorType, plte, trns), width, height }
}

function pngChannels(colorType: number): number | null {
  switch (colorType) {
    case 0:
      return 1
    case 2:
      return 3
    case 3:
      return 1
    case 4:
      return 2
    case 6:
      return 4
    default:
      return null
  }
}

function unfilterRow(
  filter: number,
  src: Buffer,
  dest: Buffer,
  prev: Buffer,
  channels: number
): boolean {
  const bpp = channels
  for (let i = 0; i < src.length; i++) {
    const x = src[i]!
    const a = i >= bpp ? dest[i - bpp]! : 0
    const b = prev[i]!
    const c = i >= bpp ? prev[i - bpp]! : 0
    let recon: number
    if (filter === 0) recon = x
    else if (filter === 1) recon = x + a
    else if (filter === 2) recon = x + b
    else if (filter === 3) recon = x + ((a + b) >> 1)
    else if (filter === 4) recon = x + paeth(a, b, c)
    else return false
    dest[i] = recon & 255
  }
  return true
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function expandToRgba(
  raw: Buffer,
  width: number,
  height: number,
  colorType: number,
  plte: Buffer | null,
  trns: Buffer | null
): Buffer {
  const out = Buffer.alloc(width * height * 4)
  let si = 0
  for (let i = 0; i < out.length; i += 4) {
    if (colorType === 6) {
      out[i] = raw[si]!
      out[i + 1] = raw[si + 1]!
      out[i + 2] = raw[si + 2]!
      out[i + 3] = raw[si + 3]!
      si += 4
    } else if (colorType === 2) {
      const r = raw[si]!
      const g = raw[si + 1]!
      const b = raw[si + 2]!
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = rgbTrnsAlpha(r, g, b, trns)
      si += 3
    } else if (colorType === 0) {
      const grey = raw[si]!
      out[i] = grey
      out[i + 1] = grey
      out[i + 2] = grey
      out[i + 3] = trns && trns.length >= 2 && grey === trns[1] ? 0 : 255
      si += 1
    } else if (colorType === 4) {
      const grey = raw[si]!
      out[i] = grey
      out[i + 1] = grey
      out[i + 2] = grey
      out[i + 3] = raw[si + 1]!
      si += 2
    } else {
      const index = raw[si]!
      const pi = index * 3
      out[i] = plte?.[pi] ?? 0
      out[i + 1] = plte?.[pi + 1] ?? 0
      out[i + 2] = plte?.[pi + 2] ?? 0
      out[i + 3] = trns && index < trns.length ? trns[index]! : 255
      si += 1
    }
  }
  return out
}

function rgbTrnsAlpha(r: number, g: number, b: number, trns: Buffer | null): number {
  if (!trns || trns.length < 6) return 255
  return r === trns[1] && g === trns[3] && b === trns[5] ? 0 : 255
}

function fitInside(
  data: Buffer,
  width: number,
  height: number,
  maxEdge: number
): { data: Buffer; width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) return { data, width, height }
  const scale = maxEdge / long
  const nextW = Math.max(1, Math.round(width * scale))
  const nextH = Math.max(1, Math.round(height * scale))
  return { data: resizeRgba(data, width, height, nextW, nextH), width: nextW, height: nextH }
}

function resizeRgba(src: Buffer, srcW: number, srcH: number, dstW: number, dstH: number): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = Math.min(1, Math.max(0, sy - y0))
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      const di = (y * dstW + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * srcW + x0) * 4 + c]!
        const p10 = src[(y0 * srcW + x1) * 4 + c]!
        const p01 = src[(y1 * srcW + x0) * 4 + c]!
        const p11 = src[(y1 * srcW + x1) * 4 + c]!
        dst[di + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy
        )
      }
    }
  }
  return dst
}

function encodePngRgba(data: Buffer, width: number, height: number): Buffer {
  const stride = width * 4
  const raw = Buffer.alloc((1 + stride) * height)
  for (let y = 0; y < height; y++) {
    const dest = y * (1 + stride)
    raw[dest] = 0
    data.copy(raw, dest + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
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
