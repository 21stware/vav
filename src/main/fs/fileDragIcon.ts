import { app, nativeImage, type NativeImage } from 'electron'

const cache = new Map<string, NativeImage>()
let fallback: NativeImage | null = null

/** 32×32 slate tile used when Launch Services has no icon yet. */
export function fallbackDragIcon(): NativeImage {
  if (fallback && !fallback.isEmpty()) return fallback
  const width = 32
  const height = 32
  const buf = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2
      const tone = edge ? 96 : 196
      buf[i] = tone
      buf[i + 1] = tone
      buf[i + 2] = tone
      buf[i + 3] = 255
    }
  }
  fallback = nativeImage.createFromBitmap(buf, { width, height })
  return fallback.isEmpty() ? nativeImage.createEmpty() : fallback
}

export async function prefetchDragIcon(path: string): Promise<void> {
  if (!path || cache.has(path)) return
  try {
    const icon = await app.getFileIcon(path, { size: 'normal' })
    if (icon && !icon.isEmpty()) cache.set(path, icon)
  } catch {
    // Keep the fallback; startDrag still needs a NativeImage.
  }
}

export function iconForDrag(path: string): NativeImage {
  return cache.get(path) ?? fallbackDragIcon()
}
