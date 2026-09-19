/**
 * Privileged local-file URL for in-app streaming previews (PDF, media, office).
 * Served by main via `protocol.handle('vav-local', …)` with Range support.
 *
 * Two forms:
 * - Query (`preview/?path=`): stable for media / PDF Range streaming.
 * - Path (`local/abs/file`): relative URL resolution works (JS modules, CSS).
 */
export function localFileStreamUrl(filePath: string): string {
  return `vav-local://preview/?path=${encodeURIComponent(filePath)}`
}

/** Path-form URL so `./app.js` next to an HTML file resolves as a sibling. */
export function localFilePageUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLead = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(withLead).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `vav-local://local${encoded}`
}

/**
 * CORS for sibling JS modules loaded from an HTML preview srcdoc (parent
 * origin). Module scripts require ACAO; classic scripts do not.
 */
export const VAV_LOCAL_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Cross-Origin-Resource-Policy': 'cross-origin'
}

/** File path encoded in a `vav-local:` request, or null if the URL is not one. */
export function parseVavLocalFilePath(requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'vav-local:') return null

  const fromQuery = url.searchParams.get('path')
  if (fromQuery) return fromQuery

  if (url.hostname === 'local') {
    let path = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    return path || null
  }
  return null
}
