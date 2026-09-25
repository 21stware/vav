import { applyWebPreviewDocument, createFixtureVav } from './fixtureVav'
import { openLiveObserve } from './liveVav'
import { parseWebPreviewScene } from './scenes'

declare global {
  interface Window {
    __vavWebPreview?: boolean
    __vavObserveLive?: boolean
  }
}

function forceFixture(search = typeof location === 'undefined' ? '' : location.search): boolean {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return query.get('fixture') === '1' || query.get('fixture') === 'true'
}

function installFixture(): void {
  const scene = parseWebPreviewScene(window.location.search)
  if (scene === 'settings') {
    const url = new URL(window.location.href)
    if (!url.searchParams.get('view')) {
      url.searchParams.set('view', 'settings')
      window.history.replaceState(null, '', url)
    }
  }
  applyWebPreviewDocument()
  window.vav = createFixtureVav({ scene })
  window.__vavWebPreview = true
  window.__vavObserveLive = false
}

/**
 * Bare browser tabs have no Electron preload. Prefer a live IPC proxy to a
 * running desktop process; otherwise install fixture sessions.
 */
export async function installWebVav(): Promise<void> {
  if (typeof window === 'undefined' || window.vav) return
  if (!forceFixture()) {
    const live = await openLiveObserve()
    if (live) {
      applyWebPreviewDocument(document, { live: true })
      window.vav = live.vav
      window.__vavWebPreview = true
      window.__vavObserveLive = true
      return
    }
  }
  installFixture()
}
