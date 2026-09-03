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
  return url.startsWith('file:')
}
