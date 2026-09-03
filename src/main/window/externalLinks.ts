import { isRendererUrl } from './rendererUrl.ts'

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Never let hyperlinks navigate the BrowserWindow away from the app shell.
 *
 * - Chat / agent log / tool cards: open http(s) in the system browser.
 * - File previews (MD/office/HTML): renderer preventDefaults on click, so
 *   `will-navigate` usually never fires for those surfaces.
 */
export function wireExternalLinks(
  contents: {
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void
    on: (
      event: 'will-navigate',
      listener: (event: { preventDefault: () => void }, url: string) => void
    ) => void
  },
  openExternal: (url: string) => void,
  isAppRendererUrl: (url: string) => boolean = isRendererUrl
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppRendererUrl(url)) return
    event.preventDefault()
    if (isHttpUrl(url)) openExternal(url)
  })
}
