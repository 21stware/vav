/**
 * Warm heavy renderer chunks before the user clicks.
 * Idempotent — Vite caches the module promise after the first call.
 */

import {
  docxCanvas,
  pdfCanvas,
  pptxCanvas,
  xlsxCanvas
} from '../components/office/officeCanvases'
import { loadFileViewer } from './fileViewerModule'

let officeWarm: Promise<unknown> | null = null

/** File canvas + its common deps (markdown preview path, etc.). */
export function prefetchFileViewer(): void {
  void loadFileViewer().catch(() => undefined)
}

/** Office router — first open of any office kind pays less. */
export function prefetchOfficeRouter(): void {
  if (officeWarm) return
  officeWarm = import('../components/office/OfficeNativeView').catch(() => {
    officeWarm = null
  })
}

/** Heuristic: path looks like a previewable non-directory file. */
export function prefetchForPath(path: string | null | undefined): void {
  if (!path) return
  prefetchFileViewer()
  const lower = path.toLowerCase()
  if (/\.(pdf|docx|xlsx|xls|pptx|doc|ppt)$/i.test(lower)) {
    prefetchOfficeRouter()
  }
}

function onIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 1500 })
  else setTimeout(fn, 60)
}

let canvasesWarm = false

/**
 * Warm the format canvases inside a hidden preview shell so a claimed shell
 * only has to paint. These are the chunks that actually gate "the file
 * appeared": SheetJS ~700 KB, pdf.js ~840 KB, pptx-renderer ~2 MB.
 *
 * One at a time on idle — a burst of megabyte parses in a background window
 * would stall whichever preview is currently visible.
 *
 * `deep` also pulls the pptx renderer; spare shells skip it so the pool does
 * not hold several copies of the heaviest canvas.
 */
export function prefetchPreviewCanvases(deep: boolean): void {
  if (canvasesWarm) return
  canvasesWarm = true
  const queue: Array<[string, () => Promise<unknown>]> = [
    ['FileViewer', loadFileViewer],
    ['OfficeNativeView', () => import('../components/office/OfficeNativeView')],
    ['DocxNativeView', docxCanvas.prefetch],
    ['PdfNativeView', pdfCanvas.prefetch],
    ['XlsxNativeView', xlsxCanvas.prefetch]
  ]
  if (deep) queue.push(['PptxNativeView', pptxCanvas.prefetch])

  const pump = (): void => {
    const next = queue.shift()
    if (!next) return
    const [name, load] = next
    const started = performance.now()
    void load()
      .catch(() => undefined)
      .then(() => {
        if (import.meta.env.DEV) {
          console.debug(`[preview-perf] warm:${name}`, (performance.now() - started).toFixed(0))
        }
        onIdle(pump)
      })
  }
  onIdle(pump)
}
