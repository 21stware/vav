/**
 * DevTools-style block pick on rendered document DOM (docx-preview, etc.).
 *
 * Single capture-phase listener on the root so only the *deepest* matching
 * element is picked — avoids table/tr/p fighting and double-fires.
 */

import type { PreviewBlock } from '@shared/previewBlock'

export type DomPickHandler = (block: PreviewBlock, event: MouseEvent) => void

/** Prefer leaf content over containers (td > p beats table). */
const DEFAULT_LEAF =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, span[class*="text"]'

/**
 * Assign stable data-block-id from tree path so re-annotate keeps the same ids.
 */
export function ensureStableBlockIds(
  root: HTMLElement,
  selector: string,
  idPrefix: string
): void {
  const nodes = Array.from(root.querySelectorAll(selector)) as HTMLElement[]
  nodes.forEach((el, index) => {
    if (!el.dataset.blockId) {
      // Path-ish stable id from document order (re-render of same doc keeps order).
      el.dataset.blockId = `${idPrefix}-${index}`
    }
    el.classList.add('office-pick-target')
  })
}

export function syncSelectedClasses(root: HTMLElement, selectedIds: string[]): void {
  const selected = new Set(selectedIds)
  // Only leaf pick targets — never paint parents that aren't in the selector set.
  root.querySelectorAll<HTMLElement>('.office-pick-target[data-block-id]').forEach((el) => {
    const id = el.dataset.blockId
    if (!id) return
    el.classList.toggle('selected', selected.has(id))
    el.classList.toggle('preview-select-region', true)
  })
}

/**
 * Attach one capture listener. `selecting` toggled via returned update().
 */
export function attachDomPick(
  root: HTMLElement,
  options: {
    selecting: boolean
    selectedIds: string[]
    onPick: DomPickHandler
    /** Leaf selectors only (default: paragraphs + cells, not table/tr wrappers). */
    selector?: string
    idPrefix?: string
  }
): () => void {
  const selector = options.selector ?? DEFAULT_LEAF
  const prefix = options.idPrefix ?? 'dom'

  ensureStableBlockIds(root, selector, prefix)
  syncSelectedClasses(root, options.selectedIds)

  // Keep selecting flag mutable so we don't re-bind every parent render.
  let selecting = options.selecting
  let onPick = options.onPick

  const onDown = (event: MouseEvent): void => {
    if (!selecting) return
    if (event.button !== 0) return
    const raw = event.target as HTMLElement | null
    if (!raw || !root.contains(raw)) return

    // Deepest element matching our leaf selector.
    const matches = Array.from(root.querySelectorAll(selector)) as HTMLElement[]
    let best: HTMLElement | null = null
    for (const el of matches) {
      if (el === raw || el.contains(raw)) {
        if (!best || best.contains(el)) best = el
      }
    }
    if (!best?.dataset.blockId) return

    event.preventDefault()
    event.stopPropagation()

    const id = best.dataset.blockId
    const blockText = (best.innerText || best.textContent || '').trim()
    if (!blockText) return

    const tag = best.tagName.toLowerCase()
    const kind =
      tag === 'td' || tag === 'th'
        ? ('cell-table' as const)
        : tag.startsWith('h')
          ? ('heading' as const)
          : tag === 'li'
            ? ('list-item' as const)
            : ('paragraph' as const)

    onPick(
      {
        id,
        kind,
        text: blockText.slice(0, 8000),
        label: blockText.slice(0, 64) || id,
        startLine: 1,
        endLine: 1,
        level: kind === 'heading' ? Number(tag.slice(1)) || 1 : undefined
      },
      event
    )
  }

  root.addEventListener('mousedown', onDown, true)

  // Public update for selection chrome without re-querying whole tree setup.
  ;(root as HTMLElement & { __officePickUpdate?: (o: {
    selecting: boolean
    selectedIds: string[]
    onPick: DomPickHandler
  }) => void }).__officePickUpdate = (o) => {
    selecting = o.selecting
    onPick = o.onPick
    syncSelectedClasses(root, o.selectedIds)
  }

  return () => {
    root.removeEventListener('mousedown', onDown, true)
    delete (root as HTMLElement & { __officePickUpdate?: unknown }).__officePickUpdate
  }
}

export function updateDomPick(
  root: HTMLElement | null,
  options: {
    selecting: boolean
    selectedIds: string[]
    onPick: DomPickHandler
  }
): void {
  if (!root) return
  const fn = (
    root as HTMLElement & {
      __officePickUpdate?: (o: {
        selecting: boolean
        selectedIds: string[]
        onPick: DomPickHandler
      }) => void
    }
  ).__officePickUpdate
  fn?.(options)
}
