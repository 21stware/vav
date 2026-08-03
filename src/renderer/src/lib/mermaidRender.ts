/**
 * Lazy mermaid rendering for markdown fences.
 * Keeps mermaid out of the main chunk until a diagram is actually present.
 */

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let diagramSeq = 0

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default
      const dark =
        typeof document !== 'undefined' &&
        document.documentElement.dataset.theme === 'dark'
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'neutral',
        fontFamily: 'var(--font-ui, system-ui, sans-serif)'
      })
      return mermaid
    })
  }
  return mermaidReady
}

/**
 * Find unrendered `.md-mermaid` nodes under `root` and paint SVG diagrams.
 * Safe to call repeatedly; already-rendered nodes are skipped.
 */
export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>('.md-mermaid:not([data-rendered])')
  if (nodes.length === 0) return

  let mermaid: typeof import('mermaid').default
  try {
    mermaid = await loadMermaid()
  } catch (err) {
    for (const el of nodes) {
      el.dataset.rendered = 'error'
      el.classList.add('md-mermaid-error')
      el.textContent = `Mermaid failed to load: ${(err as Error).message}`
    }
    return
  }

  // Theme may have flipped since last load.
  const dark = document.documentElement.dataset.theme === 'dark'
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: 'var(--font-ui, system-ui, sans-serif)'
  })

  for (const el of nodes) {
    let source = ''
    const b64 = el.dataset.b64 || el.closest('.md-mermaid-wrap')?.getAttribute('data-mermaid-b64')
    if (b64) {
      try {
        source = decodeURIComponent(escape(atob(b64)))
      } catch {
        source = ''
      }
    }
    if (!source.trim()) {
      source = el.querySelector('.md-mermaid-fallback')?.textContent ?? el.textContent ?? ''
    }
    if (!source.trim()) {
      el.dataset.rendered = 'empty'
      continue
    }
    const id = `vav-mmd-${++diagramSeq}`
    try {
      const { svg } = await mermaid.render(id, source.trim())
      el.innerHTML = svg
      el.dataset.rendered = 'ok'
      el.classList.add('md-mermaid-ready')
    } catch (err) {
      el.dataset.rendered = 'error'
      el.classList.add('md-mermaid-error')
      el.textContent = (err as Error).message || 'Invalid mermaid diagram'
    }
  }
}
