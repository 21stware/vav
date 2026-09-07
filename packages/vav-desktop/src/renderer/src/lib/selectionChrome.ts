/**
 * Screen-space selection HUD (the camera).
 *
 * Content is the subject: it may be CSS-scaled, type-zoomed, or scrolled.
 * Interaction chrome is a sibling overlay *inside* the visual frame — never
 * a child of the scale transform, never a child of the window.
 *
 * Natural (pre-transform) boxes are measured once on select / hover via
 * offsetLeft/Top (layout space, ignores CSS scale). Zoom writes --doc-zoom
 * in the same turn as the subject's transform. Scroll is compositor-native.
 */

export type ClientRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type HostRect = ClientRect & { width: number; height: number }

export type ChromeKind = 'selected' | 'hovered'

export type ChromeBox = {
  id: string
  left: number
  top: number
  width: number
  height: number
  kind: ChromeKind
  media: boolean
}

export const CHROME_SELECTED_SEL = [
  '.preview-select-region.selected',
  '.office-pick-target.selected',
  '.pdf-page.pdf-pick-page.selected',
  '.pdf-page .textLayer span.selected',
  '.preview-code-overlay.selected',
  '.preview-code-line.is-selected',
  'tr.selected',
  'tr.row-selected',
  '.zip-tree-row.selected',
  '[data-block-id].selected'
].join(',')

const CHROME_CLASSED_HOVER_SEL = [
  '.preview-code-overlay.hovered',
  '.preview-code-line.is-hovered',
  '.pdf-page.pdf-pick-page.hovered',
  '.pdf-page .textLayer span.hovered'
].join(',')

const CHROME_HIT_SEL = [
  '.preview-select-region',
  '.office-pick-target',
  '.pdf-page.pdf-pick-page',
  '.pdf-page .textLayer span',
  '.preview-code-overlay',
  '.preview-code-line',
  '.zip-tree-row',
  'tr[data-block-id]',
  '[data-block-id]'
].join(',')

const HUD_IGNORE_SEL = [
  '.selection-hud',
  '.selection-agent-fab',
  '.doc-zoom-controls',
  '.page-pager'
].join(',')

const MIN_BOX = 2
const MIN_HOST = 40

export function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function isRowLikeId(id: string): boolean {
  return /(?:^|-)row-\d+$/i.test(id) || /^row-\d+$/i.test(id)
}

export function snapScreen(n: number, dpr = 1): number {
  const p = dpr > 0 ? dpr : 1
  return Math.round(n * p) / p
}

/** Viewport rect → host-local box. */
export function projectToHost(
  host: HostRect,
  world: ClientRect,
  dpr = 1
): { left: number; top: number; width: number; height: number } {
  return {
    left: snapScreen(world.left - host.left, dpr),
    top: snapScreen(world.top - host.top, dpr),
    width: snapScreen(world.right - world.left, dpr),
    height: snapScreen(world.bottom - world.top, dpr)
  }
}

export function intersects(a: ClientRect, b: ClientRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

export function unionRects(rects: ClientRect[]): ClientRect | null {
  let box: ClientRect | null = null
  for (const r of rects) {
    if (r.right - r.left < MIN_BOX || r.bottom - r.top < MIN_BOX) continue
    if (!box) {
      box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    } else {
      box.left = Math.min(box.left, r.left)
      box.top = Math.min(box.top, r.top)
      box.right = Math.max(box.right, r.right)
      box.bottom = Math.max(box.bottom, r.bottom)
    }
  }
  return box
}

export function chromeBoxesEqual(a: ChromeBox[], b: ChromeBox[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.id !== y.id ||
      x.kind !== y.kind ||
      x.media !== y.media ||
      x.left !== y.left ||
      x.top !== y.top ||
      x.width !== y.width ||
      x.height !== y.height
    ) {
      return false
    }
  }
  return true
}

export function isMediaPaintTarget(el: HTMLElement): boolean {
  return (
    el.classList.contains('media-pick-frame') ||
    !!el.closest('.preview-media-stage, .image-zoom-content, .file-viewer-media')
  )
}

export function queryDeep(host: HTMLElement, selector: string): HTMLElement[] {
  const out: HTMLElement[] = []
  host.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el))
  host.querySelectorAll('iframe').forEach((iframe) => {
    try {
      iframe.contentDocument
        ?.querySelectorAll<HTMLElement>(selector)
        .forEach((el) => out.push(el))
    } catch {
      // Cross-origin — skip.
    }
  })
  return out
}

function queryOneDeep(host: HTMLElement, selector: string): HTMLElement | null {
  const local = host.querySelector<HTMLElement>(selector)
  if (local) return local
  for (const iframe of Array.from(host.querySelectorAll('iframe'))) {
    try {
      const hit = iframe.contentDocument?.querySelector<HTMLElement>(selector)
      if (hit) return hit
    } catch {
      // Cross-origin — skip.
    }
  }
  return null
}

/**
 * Empty sheet cells often promote the pick to the whole row, and the selected
 * class lands on the narrow gutter <th>. Prefer the enclosing <tr>.
 */
export function resolveSelectedTarget(
  host: HTMLElement,
  preferredId: string | null
): HTMLElement | null {
  let target: HTMLElement | null = null
  if (preferredId) {
    const safe = escapeAttr(preferredId)
    target =
      queryOneDeep(host, `[data-block-id="${safe}"].selected`) ||
      queryOneDeep(host, `[data-block-id="${safe}"]`)
  }
  if (!target) {
    const all = queryDeep(host, CHROME_SELECTED_SEL)
    target = all.length > 0 ? all[all.length - 1]! : null
  }
  if (!target) return null

  const gutter = target.closest(
    'th.csv-sheet-gutter, td.csv-sheet-gutter, th.structured-sheet-gutter, td.structured-sheet-gutter'
  )
  if (gutter || (preferredId && isRowLikeId(preferredId))) {
    const row = target.closest('tr')
    if (row instanceof HTMLElement) return row
  }

  const rect = target.getBoundingClientRect()
  if ((rect.width < 8 || rect.height < 8) && target.closest('table')) {
    const row = target.closest('tr')
    if (row instanceof HTMLElement) {
      const rowRect = row.getBoundingClientRect()
      if (rowRect.width >= 8 && rowRect.height >= 8) return row
    }
  }

  return target
}

/** Collect every selected paint target; fall back to whatever is marked selected. */
export function collectSelectedElements(
  host: HTMLElement,
  selectedIds: string[]
): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  for (const id of selectedIds) {
    const el = resolveSelectedTarget(host, id)
    if (el && !seen.has(el)) {
      seen.add(el)
      out.push(el)
    }
  }
  if (out.length === 0) {
    for (const el of queryDeep(host, CHROME_SELECTED_SEL)) {
      if (!seen.has(el)) {
        seen.add(el)
        out.push(el)
      }
    }
  }
  return out
}

function promoteEmptyLeafToCell(el: HTMLElement, host: HTMLElement): HTMLElement {
  const tag = el.tagName.toLowerCase()
  if (tag === 'td' || tag === 'th') return el
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return el
  if (el.tagName === 'IMG' || el.querySelector?.('img')) return el
  const cell = el.closest('td, th')
  if (
    cell instanceof HTMLElement &&
    host.contains(cell) &&
    (cell.dataset.blockId || cell.matches(CHROME_HIT_SEL))
  ) {
    return cell
  }
  return el
}

function isHudIgnore(el: Element): boolean {
  return !!el.closest(HUD_IGNORE_SEL)
}

/** Deepest pick target under a pointer, matching the old :has() hover rule. */
export function deepestPickFromTarget(
  host: HTMLElement,
  raw: EventTarget | null
): HTMLElement | null {
  if (!(raw instanceof Element)) return null
  if (isHudIgnore(raw)) return null
  let el: Element | null = raw
  const root = raw.getRootNode()
  const bound =
    root instanceof Document || root instanceof ShadowRoot ? (root as Document | ShadowRoot) : host
  while (el && el !== host && el !== bound) {
    if (el instanceof HTMLElement && el.matches(CHROME_HIT_SEL)) {
      return promoteEmptyLeafToCell(
        el,
        host.contains(el) ? host : el.ownerDocument.body ?? el
      )
    }
    el = el.parentElement
  }
  return null
}

export function isSelectedPaintTarget(el: HTMLElement): boolean {
  return (
    el.classList.contains('selected') ||
    el.classList.contains('is-selected') ||
    el.classList.contains('row-selected')
  )
}

/**
 * Hover paint targets. Class-driven hovers (code overlays, PDF lines) win so
 * we don't collapse a multi-line block to the single row under the cursor.
 */
export function collectHoverElements(
  host: HTMLElement,
  pointerTarget: EventTarget | null
): HTMLElement[] {
  const classed = queryDeep(host, CHROME_CLASSED_HOVER_SEL).filter(
    (el) => !isSelectedPaintTarget(el)
  )
  if (classed.length > 0) return classed

  const hit = deepestPickFromTarget(host, pointerTarget)
  if (!hit || isSelectedPaintTarget(hit)) return []
  return [hit]
}

function paintId(el: HTMLElement, kind: ChromeKind, index: number): string {
  const raw = el.dataset.blockId || el.dataset.lineId || el.dataset.line || 'el'
  return `${kind}-${raw}-${index}`
}

/** Viewport rect of `el` in the same space as `host` (iframe offsets included). */
export function worldRectOf(el: HTMLElement, host: HTMLElement): ClientRect {
  const r = el.getBoundingClientRect()
  const hostWin = host.ownerDocument.defaultView
  let left = r.left
  let top = r.top
  let win: Window | null = el.ownerDocument.defaultView
  while (win && hostWin && win !== hostWin) {
    const frame = win.frameElement
    if (!(frame instanceof HTMLElement)) break
    const fr = frame.getBoundingClientRect()
    left += fr.left
    top += fr.top
    win = frame.ownerDocument.defaultView
  }
  return { left, top, right: left + r.width, bottom: top + r.height }
}

function projectEl(
  host: HTMLElement,
  hostRect: HostRect,
  el: HTMLElement,
  kind: ChromeKind,
  index: number,
  dpr: number
): ChromeBox | null {
  const r = worldRectOf(el, host)
  if (r.right - r.left < MIN_BOX || r.bottom - r.top < MIN_BOX) return null
  if (!intersects(hostRect, r)) return null
  const box = projectToHost(hostRect, r, dpr)
  if (box.width < MIN_BOX || box.height < MIN_BOX) return null
  return {
    id: paintId(el, kind, index),
    ...box,
    kind,
    media: isMediaPaintTarget(el)
  }
}

export function hostRectOf(host: HTMLElement): HostRect {
  const r = host.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

/** Project selected + hovered content boxes into the host's local space. */
export function measureChromeBoxes(
  host: HTMLElement,
  selectedIds: string[],
  pointerTarget: EventTarget | null,
  dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
): ChromeBox[] {
  const hostRect = hostRectOf(host)
  if (hostRect.width < MIN_HOST || hostRect.height < MIN_HOST) return []

  const selectedEls = collectSelectedElements(host, selectedIds)
  const selectedSet = new Set(selectedEls)
  const hoverEls = collectHoverElements(host, pointerTarget).filter((el) => !selectedSet.has(el))

  const boxes: ChromeBox[] = []
  selectedEls.forEach((el, i) => {
    const box = projectEl(host, hostRect, el, 'selected', i, dpr)
    if (box) boxes.push(box)
  })
  hoverEls.forEach((el, i) => {
    const box = projectEl(host, hostRect, el, 'hovered', i, dpr)
    if (box) boxes.push(box)
  })
  return boxes
}

export function unionClientRects(els: HTMLElement[], host: HTMLElement): ClientRect | null {
  return unionRects(els.map((el) => worldRectOf(el, host)))
}

/*
 * Camera model — natural (pre-transform) boxes + a CSS --doc-zoom written in
 * the same style turn as the subject's scale. Scroll is free: the HUD lives
 * inside the scrollport, as a sibling of the scaled subject, so the compositor
 * moves them together. Zoom never calls getBoundingClientRect / offset*.
 */

export type NaturalBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  kind: ChromeKind
  media: boolean
  /** Cover the frame (image wrapper already *is* the visual box). */
  fill: boolean
}

export const DOC_ZOOM_VAR = '--doc-zoom'
export const DOC_ZOOM_EVENT = 'vav:doc-zoom'

export function notifyDocZoom(target: EventTarget | null): void {
  if (!target) return
  target.dispatchEvent(new Event(DOC_ZOOM_EVENT, { bubbles: true }))
}

/**
 * Persist scale on the frame (dataset, not a custom property) and write
 * `--doc-zoom` only onto the HUD sibling. A custom property on the frame
 * inherits into the whole document and restyles it on every pinch tick.
 */
function isHtmlEl(n: unknown): n is HTMLElement {
  return (
    typeof n === 'object' &&
    n !== null &&
    'classList' in n &&
    'style' in n &&
    typeof (n as HTMLElement).querySelector === 'function'
  )
}

export function writeDocZoom(frame: HTMLElement | null, scale: number): void {
  if (!frame) return
  frame.dataset.docZoom = String(scale)
  frame.style.removeProperty(DOC_ZOOM_VAR)
  let hud: Element | null = null
  try {
    hud = frame.querySelector(':scope > .selection-hud')
  } catch {
    hud = null
  }
  hud = hud ?? frame.querySelector('.selection-hud')
  if (isHtmlEl(hud)) hud.style.setProperty(DOC_ZOOM_VAR, String(scale))
}

/** Visual box from a natural box. Used in tests; live paint uses CSS vars. */
export function projectNatural(
  box: Pick<NaturalBox, 'x' | 'y' | 'w' | 'h'>,
  scale: number
): { left: number; top: number; width: number; height: number } {
  return { left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }
}

/**
 * Invert a one-shot visual measure back into natural space.
 * Used only when the offsetParent walk cannot reach the subject (some Word
 * tables / absolutely placed drawing canvases). Never call on zoom/scroll.
 */
export function unprojectVisual(
  visual: { left: number; top: number; width: number; height: number },
  frame: { left: number; top: number },
  scale: number
): { x: number; y: number; w: number; h: number } | null {
  const s = scale > 0 ? scale : 1
  const w = visual.width / s
  const h = visual.height / s
  if (w < MIN_BOX && h < MIN_BOX) return null
  return {
    x: (visual.left - frame.left) / s,
    y: (visual.top - frame.top) / s,
    w,
    h
  }
}

export function readDocZoom(frame: HTMLElement): number {
  const raw = frame.dataset.docZoom || frame.style.getPropertyValue(DOC_ZOOM_VAR)
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

const CHROME_STATE_CLASS = /(^|\s)(selected|hovered|is-selected|is-hovered)(\s|$)/

function elementTouchesChrome(el: Element, selectedIds: ReadonlySet<string>): boolean {
  if (isHtmlEl(el) && el.classList.contains('selection-hud')) return false
  if (typeof el.closest === 'function' && el.closest('.selection-hud')) return false
  if (isHtmlEl(el)) {
    if (CHROME_STATE_CLASS.test(el.className)) return true
    const id = el.dataset.blockId
    if (id && selectedIds.has(id)) return true
    if (el.classList.contains('preview-code-overlay')) return true
  }
  return Boolean(
    el.querySelector?.(
      '.selected, .hovered, .is-selected, .is-hovered, .preview-code-overlay, [data-block-id].selected'
    )
  )
}

/** True when a mutation might have moved / remounted a paint target. */
export function chromeMutationRelevant(
  rec: {
    type: string
    target: EventTarget | null
    addedNodes?: ArrayLike<Node>
    removedNodes?: ArrayLike<Node>
  },
  selectedIds: ReadonlySet<string>
): boolean {
  if (rec.type === 'attributes') {
    const el = rec.target
    return isHtmlEl(el) && elementTouchesChrome(el, selectedIds)
  }
  if (rec.type !== 'childList') return false
  const lists = [rec.addedNodes, rec.removedNodes]
  for (const list of lists) {
    if (!list) continue
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if (isHtmlEl(n) && elementTouchesChrome(n, selectedIds)) return true
    }
  }
  return false
}

function naturalFromVisual(el: HTMLElement, frame: HTMLElement): {
  x: number
  y: number
  w: number
  h: number
} | null {
  const er = el.getBoundingClientRect()
  const fr = frame.getBoundingClientRect()
  return unprojectVisual(er, fr, readDocZoom(frame))
}

/**
 * Top-center origin + a frame sized to the visual page + a centered wrapper
 * collapses to n·scale. Keep this identity under test so a future origin
 * change cannot silently drift the HUD.
 */
export function visualXTopCenter(naturalX: number, naturalW: number, scale: number): number {
  const visW = naturalW * scale
  return visW / 2 + (naturalX - naturalW / 2) * scale
}

export const CHROME_FRAME_SEL = [
  '.docx-fit-frame',
  '.pdf-page-frame',
  '.image-zoom-content',
  '[data-chrome-frame]'
].join(',')

export function nearestScrollPort(el: HTMLElement, stop: HTMLElement | null = null): HTMLElement {
  let node: HTMLElement | null = el
  while (node && node !== stop) {
    const oy = node.scrollHeight - node.clientHeight
    const ox = node.scrollWidth - node.clientWidth
    if (oy > 1 || ox > 1) {
      const cs = node.ownerDocument.defaultView?.getComputedStyle(node)
      const y = cs?.overflowY ?? ''
      const x = cs?.overflowX ?? ''
      if (y === 'auto' || y === 'scroll' || x === 'auto' || x === 'scroll') return node
    }
    node = node.parentElement
  }
  return stop ?? el
}

export function resolveChromeFrame(el: HTMLElement, fallback: HTMLElement): HTMLElement {
  const tagged = el.closest<HTMLElement>(CHROME_FRAME_SEL)
  if (tagged) return tagged
  const slide = el.closest<HTMLElement>('[data-slide-index]')
  const outer = slide?.firstElementChild
  if (outer instanceof HTMLElement) return outer
  if (el.ownerDocument !== fallback.ownerDocument && el.ownerDocument.body) {
    return el.ownerDocument.body
  }
  return nearestScrollPort(el, fallback)
}

export function ensureChromeFrame(frame: HTMLElement): void {
  const win = frame.ownerDocument.defaultView
  const pos = frame.style.position || win?.getComputedStyle(frame).position || ''
  if (pos === 'static' || pos === '') frame.style.position = 'relative'
}

export function resolveChromeSubject(el: HTMLElement, frame: HTMLElement): HTMLElement {
  const geometric =
    frame.classList.contains('docx-fit-frame') ||
    frame.classList.contains('pdf-page-frame') ||
    frame.classList.contains('image-zoom-content') ||
    frame.dataset.chromeFrame === 'true'
  if (!geometric) return frame
  const marked = frame.querySelector<HTMLElement>('[data-chrome-subject]')
  if (marked && (marked === el || marked.contains(el))) return marked
  const named = frame.querySelector<HTMLElement>(
    '.docx-native-wrapper, .docx-wrapper, .pdf-page, [data-chrome-subject]'
  )
  if (named && (named === el || named.contains(el))) return named
  const inner = frame.firstElementChild
  if (inner instanceof HTMLElement && (inner === el || inner.contains(el))) return inner
  return frame
}

/**
 * Layout box of `el` in `ancestor`'s untransformed space.
 * offsetLeft/Top/Width/Height ignore CSS transforms — that is the point.
 * Do not call this on the zoom/scroll hot path.
 */
export function offsetBoxRelativeTo(
  el: HTMLElement,
  ancestor: HTMLElement
): { x: number; y: number; w: number; h: number } | null {
  const w = el.offsetWidth
  const h = el.offsetHeight
  if (el === ancestor) {
    return w >= MIN_BOX && h >= MIN_BOX ? { x: 0, y: 0, w, h } : null
  }
  if (w < MIN_BOX && h < MIN_BOX) return null

  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  const seen = new Set<HTMLElement>()
  while (node && node !== ancestor) {
    if (seen.has(node)) return null
    seen.add(node)
    x += node.offsetLeft
    y += node.offsetTop
    const next: Element | null = node.offsetParent
    if (next === ancestor) {
      return { x, y, w, h }
    }
    if (next instanceof HTMLElement && (next === ancestor || ancestor.contains(next))) {
      node = next
      continue
    }
    return null
  }
  return node === ancestor ? { x, y, w, h } : null
}

function naturalId(el: HTMLElement, kind: ChromeKind, index: number): string {
  const raw = el.dataset.blockId || el.dataset.lineId || el.dataset.line || 'el'
  return `${kind}-${raw}-${index}`
}

export type ChromeLayer = { frame: HTMLElement; boxes: NaturalBox[] }

export function collectNaturalLayers(
  host: HTMLElement,
  selectedIds: string[],
  pointerTarget: EventTarget | null
): ChromeLayer[] {
  const selectedEls = collectSelectedElements(host, selectedIds)
  const selectedSet = new Set(selectedEls)
  const hoverEls = collectHoverElements(host, pointerTarget).filter((el) => !selectedSet.has(el))

  const byFrame = new Map<HTMLElement, NaturalBox[]>()
  const push = (el: HTMLElement, kind: ChromeKind, index: number): void => {
    const frame = resolveChromeFrame(el, host)
    const fill = isMediaPaintTarget(el) || frame.classList.contains('image-zoom-content')
    let geom: { x: number; y: number; w: number; h: number } | null = null
    if (!fill) {
      const subject = resolveChromeSubject(el, frame)
      geom = offsetBoxRelativeTo(el, subject) ?? naturalFromVisual(el, frame)
      if (!geom) return
    }
    const box: NaturalBox = {
      id: naturalId(el, kind, index),
      x: geom?.x ?? 0,
      y: geom?.y ?? 0,
      w: geom?.w ?? 0,
      h: geom?.h ?? 0,
      kind,
      media: fill,
      fill
    }
    ensureChromeFrame(frame)
    const list = byFrame.get(frame)
    if (list) list.push(box)
    else byFrame.set(frame, [box])
  }

  selectedEls.forEach((el, i) => push(el, 'selected', i))
  hoverEls.forEach((el, i) => push(el, 'hovered', i))

  const layers: ChromeLayer[] = []
  byFrame.forEach((boxes, frame) => layers.push({ frame, boxes }))
  return layers
}

export function chromeLayersEqual(a: ChromeLayer[], b: ChromeLayer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.frame !== y.frame || x.boxes.length !== y.boxes.length) return false
    for (let j = 0; j < x.boxes.length; j++) {
      const p = x.boxes[j]!
      const q = y.boxes[j]!
      if (
        p.id !== q.id ||
        p.kind !== q.kind ||
        p.fill !== q.fill ||
        p.media !== q.media ||
        p.x !== q.x ||
        p.y !== q.y ||
        p.w !== q.w ||
        p.h !== q.h
      ) {
        return false
      }
    }
  }
  return true
}

export function unionNatural(boxes: NaturalBox[]): {
  x: number
  y: number
  w: number
  h: number
} | null {
  const usable = boxes.filter((b) => b.fill || (b.w >= MIN_BOX && b.h >= MIN_BOX))
  if (usable.length === 0) return null
  if (usable.some((b) => b.fill)) return { x: 0, y: 0, w: 0, h: 0 }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of usable) {
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
