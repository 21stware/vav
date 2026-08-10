/**
 * DevTools-style block pick on rendered document DOM (docx-preview, pptx, etc.).
 *
 * Single capture-phase listener on the root so only the *deepest* matching
 * element is picked — avoids table/tr/p fighting and double-fires.
 *
 * Click (no drag) picks for Agent; drag selects text for copy. Never
 * preventDefault on mousedown.
 */

import type { PreviewBlock } from '@shared/previewBlock'
import { scheduleClickPick } from '../../lib/clickPick'

export type DomPickHandler = (block: PreviewBlock, event: MouseEvent) => void

/** Prefer leaf content over containers (td > p beats table). */
const DEFAULT_LEAF =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, span[class*="text"]'

/**
 * Assign stable data-block-id from tree path so re-annotate keeps the same ids.
 * When `force` is true, renumber every match (use after dynamic re-mount).
 */
export function ensureStableBlockIds(
  root: HTMLElement,
  selector: string,
  idPrefix: string,
  force = false
): void {
  const nodes = Array.from(root.querySelectorAll(selector)) as HTMLElement[]
  nodes.forEach((el, index) => {
    if (force || !el.dataset.blockId) {
      el.dataset.blockId = `${idPrefix}-${index}`
      el.setAttribute('data-block-id', el.dataset.blockId)
    }
    el.classList.add('office-pick-target', 'preview-select-region')
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

/** Deepest element matching `selector` that contains (or is) `raw`. */
export function findDeepestMatch(
  root: HTMLElement,
  raw: HTMLElement,
  selector: string
): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll(selector)) as HTMLElement[]
  let best: HTMLElement | null = null
  for (const el of matches) {
    if (el === raw || el.contains(raw)) {
      if (!best || best.contains(el)) best = el
    }
  }
  return best
}

function blockKindForElement(el: HTMLElement): PreviewBlock['kind'] {
  const tag = el.tagName.toLowerCase()
  if (tag === 'td' || tag === 'th') return 'cell-table'
  if (tag.startsWith('h') && tag.length === 2) return 'heading'
  if (tag === 'li') return 'list-item'
  if (el.dataset.pickKind === 'slide') return 'slide'
  return 'paragraph'
}

/**
 * When the deepest match is an empty paragraph/span inside a table cell,
 * prefer the cell (which is also a pick target). Keeps empty-cell hover + click aligned.
 */
function promoteEmptyLeafToCell(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  const tag = el.tagName.toLowerCase()
  if (tag === 'td' || tag === 'th') return el
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return el
  // Images keep their own target even when nested in a cell.
  if (el.dataset.pickKind === 'image' || el.tagName === 'IMG' || el.querySelector?.('img')) {
    return el
  }
  const cell = el.closest('td, th') as HTMLElement | null
  if (!cell || !root.contains(cell) || !cell.dataset.blockId) return el
  return cell
}

export type AttachDomPickOptions = {
  selecting: boolean
  selectedIds: string[]
  onPick: DomPickHandler
  /** Leaf selectors only (default: paragraphs + cells, not table/tr wrappers). */
  selector?: string
  idPrefix?: string
  /**
   * Run before hit-testing (e.g. re-tag dynamically mounted slides/shapes).
   * Must be cheap — called on every mousedown.
   */
  beforeDown?: (root: HTMLElement) => void
  /**
   * When no leaf matches, try this (e.g. whole slide). Return null to miss.
   * Should not return a leaf that is an ancestor of a matched leaf.
   */
  resolveFallback?: (raw: HTMLElement, root: HTMLElement) => HTMLElement | null
}

/**
 * Attach one capture listener. `selecting` toggled via returned update().
 */
export function attachDomPick(
  root: HTMLElement,
  options: AttachDomPickOptions
): () => void {
  const selector = options.selector ?? DEFAULT_LEAF
  const prefix = options.idPrefix ?? 'dom'

  ensureStableBlockIds(root, selector, prefix)
  syncSelectedClasses(root, options.selectedIds)

  // Keep selecting flag mutable so we don't re-bind every parent render.
  let selecting = options.selecting
  let onPick = options.onPick
  let beforeDown = options.beforeDown
  let resolveFallback = options.resolveFallback

  const onDown = (event: MouseEvent): void => {
    if (!selecting) return
    if (event.button !== 0) return
    const raw = event.target as HTMLElement | null
    if (!raw || !root.contains(raw)) return

    beforeDown?.(root)
    // Ids may have been assigned in beforeDown — keep prefix scheme stable.
    ensureStableBlockIds(root, selector, prefix)

    // Deepest element matching our leaf selector.
    let best = findDeepestMatch(root, raw, selector)

    // Optional container fallback (e.g. pptx slide chrome) when not on a leaf.
    if (!best?.dataset.blockId && resolveFallback) {
      const fb = resolveFallback(raw, root)
      if (fb?.dataset.blockId) best = fb
    }

    if (!best?.dataset.blockId) return

    // Empty <p>/<span> inside a table cell: promote to the cell so the whole
    // empty cell is pickable (hover already outlined the leaf; click must match).
    best = promoteEmptyLeafToCell(best, root) ?? best

    const rawText = (best.innerText || best.textContent || '').replace(/\s+/g, ' ').trim()
    const isImage =
      best.dataset.pickKind === 'image' ||
      best.tagName === 'IMG' ||
      !!best.querySelector?.('img')
    const isCell = (() => {
      const tag = best!.tagName.toLowerCase()
      return tag === 'td' || tag === 'th'
    })()
    // Pictures / empty table cells have no text — still pickable with a placeholder.
    const blockText =
      rawText ||
      (isImage ? best.dataset.pickLabel || 'Image' : '') ||
      (isCell ? best.dataset.pickLabel || '(empty cell)' : '')
    if (!blockText) return

    // Allow native text select/copy — only stop bubbling so parents don't also pick.
    event.stopPropagation()

    const id = best.dataset.blockId
    const kind: PreviewBlock['kind'] =
      isImage && !rawText ? 'image' : blockKindForElement(best)
    const tag = best.tagName.toLowerCase()
    const label =
      rawText.slice(0, 64) ||
      (isCell ? best.dataset.pickLabel || '(empty cell)' : '') ||
      (isImage ? best.dataset.pickLabel || 'Image' : '') ||
      id

    const win = root.ownerDocument?.defaultView ?? window
    scheduleClickPick(
      { button: event.button, clientX: event.clientX, clientY: event.clientY },
      () => {
        onPick(
          {
            id,
            kind,
            text: blockText.slice(0, 8000),
            label,
            startLine: 1,
            endLine: 1,
            level: kind === 'heading' ? Number(tag.slice(1)) || 1 : undefined
          },
          event
        )
      },
      { win }
    )
  }

  root.addEventListener('mousedown', onDown, true)

  // Public update for selection chrome without re-querying whole tree setup.
  ;(
    root as HTMLElement & {
      __officePickUpdate?: (o: {
        selecting: boolean
        selectedIds: string[]
        onPick: DomPickHandler
        beforeDown?: AttachDomPickOptions['beforeDown']
        resolveFallback?: AttachDomPickOptions['resolveFallback']
      }) => void
    }
  ).__officePickUpdate = (o) => {
    selecting = o.selecting
    onPick = o.onPick
    if (o.beforeDown !== undefined) beforeDown = o.beforeDown
    if (o.resolveFallback !== undefined) resolveFallback = o.resolveFallback
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
    beforeDown?: AttachDomPickOptions['beforeDown']
    resolveFallback?: AttachDomPickOptions['resolveFallback']
  }
): void {
  if (!root) return
  const fn = (
    root as HTMLElement & {
      __officePickUpdate?: (o: {
        selecting: boolean
        selectedIds: string[]
        onPick: DomPickHandler
        beforeDown?: AttachDomPickOptions['beforeDown']
        resolveFallback?: AttachDomPickOptions['resolveFallback']
      }) => void
    }
  ).__officePickUpdate
  fn?.(options)
}
