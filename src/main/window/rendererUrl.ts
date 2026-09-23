import { fileURLToPath } from 'node:url'

/** Packaged renderer HTML entries loaded from `out/renderer/`. */
const RENDERER_FILE_ENTRY = /\/out\/renderer\/(?:index|screenshot|faaaaast)\.html$/i

/** The app's own entry (dev server or packaged file://), not a chat hyperlink. */
export function isRendererUrl(
  url: string,
  devBase = process.env.ELECTRON_RENDERER_URL
): boolean {
  if (
    devBase &&
    (url === devBase || url.startsWith(devBase + '/') || url.startsWith(devBase + '?'))
  ) {
    return true
  }
  if (!url.startsWith('file:')) return false
  try {
    const path = fileURLToPath(url.split('#')[0]!.split('?')[0]!)
    return RENDERER_FILE_ENTRY.test(path.replace(/\\/g, '/'))
  } catch {
    return false
  }
}
