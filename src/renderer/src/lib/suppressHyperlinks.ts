/**
 * Document / chat surfaces show hyperlinks for readability, but must not
 * navigate the BrowserWindow or open the system browser on click.
 *
 * Allow-list (still interactive):
 * - `a.md-file-link` — local path mention → open file preview (handled by MarkdownView)
 * - `a.web-title` / `.web-hit a` — tool-card search results (intentional external open)
 * - `a[data-allow-nav]` — opt-in escape hatch
 */

const ALLOW_SELECTOR =
  'a.md-file-link, a.web-title, .web-hit a, a[data-allow-nav], [data-allow-nav] a'

type ClickLike = {
  target: EventTarget | null
  button?: number
  preventDefault: () => void
  stopPropagation: () => void
}

/**
 * Call from click handlers (bubble or capture). Returns true if a hyperlink
 * was suppressed.
 */
export function suppressHyperlinkClick(event: ClickLike): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false

  // Only primary-button plain clicks.
  if (typeof event.button === 'number' && event.button !== 0) return false

  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (!anchor) return false

  // Explicit product affordances that should still act.
  if (anchor.matches(ALLOW_SELECTOR) || anchor.closest('[data-allow-nav]')) {
    return false
  }

  // In-page fragments (#section) — still block so preview never jumps.
  event.preventDefault()
  event.stopPropagation()
  return true
}

/** Attach capture-phase click + auxclick suppression on a root (document previews). */
export function installHyperlinkSuppression(root: HTMLElement | Document): () => void {
  const onClick = (event: Event): void => {
    suppressHyperlinkClick(event as MouseEvent)
  }
  // Middle-click / modified open in some hosts.
  const onAux = (event: Event): void => {
    const me = event as MouseEvent
    const target = me.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href]')
    if (!anchor || anchor.matches(ALLOW_SELECTOR) || anchor.closest('[data-allow-nav]')) return
    me.preventDefault()
    me.stopPropagation()
  }
  root.addEventListener('click', onClick, true)
  root.addEventListener('auxclick', onAux, true)
  return () => {
    root.removeEventListener('click', onClick, true)
    root.removeEventListener('auxclick', onAux, true)
  }
}
