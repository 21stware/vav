import { clipboard, nativeImage } from 'electron'

/**
 * Put a PNG on the system clipboard as a native image.
 * Do not follow this with `writeBuffer` — that starts a new pasteboard
 * transaction and wipes the image.
 */
export function writePngToClipboard(
  bytes: Buffer
): { ok: true } | { ok: false; error: string } {
  if (!bytes.length) return { ok: false, error: 'empty image' }
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return { ok: false, error: 'invalid png' }
  clipboard.writeImage(image)
  return { ok: true }
}
