/**
 * Lazy highlight.js — keep the common grammar pack out of the first paint
 * graph. Until it resolves, callers fall back to escaped plain text; when it
 * lands we clear markdown caches so the next render picks up real highlighting.
 */

type Hljs = typeof import('highlight.js/lib/common').default

let hljs: Hljs | null = null
let loading: Promise<Hljs> | null = null
const readyListeners = new Set<() => void>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Kick off the dynamic import (idempotent). */
export function ensureHljs(): void {
  if (hljs || loading) return
  loading = import('highlight.js/lib/common')
    .then((mod) => {
      hljs = mod.default
      loading = null
      for (const listener of readyListeners) listener()
      readyListeners.clear()
      return hljs
    })
    .catch((err) => {
      loading = null
      console.error('[hljs] failed to load', err)
      throw err
    })
}

/** Subscribe once for “hljs just became available” (cache bust / remount). */
export function onHljsReady(listener: () => void): () => void {
  if (hljs) {
    listener()
    return () => undefined
  }
  readyListeners.add(listener)
  ensureHljs()
  return () => {
    readyListeners.delete(listener)
  }
}

export function highlightWithHljs(code: string, language?: string): string {
  ensureHljs()
  if (!hljs) return escapeHtml(code)
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      // fall through
    }
  }
  if (code.length > 0 && code.length < 80_000 && code.includes('\n')) {
    try {
      return hljs.highlightAuto(code).value
    } catch {
      // fall through
    }
  }
  return escapeHtml(code)
}

export function highlightFence(code: string, language: string): string {
  ensureHljs()
  if (!hljs) return escapeHtml(code)
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      // fall through
    }
  }
  return escapeHtml(code)
}
