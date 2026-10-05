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
    // URL pathname, not fileURLToPath: that throws on Windows for drive-less `file:///app/...`.
    return RENDERER_FILE_ENTRY.test(decodeURIComponent(new URL(url).pathname))
  } catch {
    return false
  }
}
