/**
 * Warm heavy renderer chunks before the user clicks.
 * Idempotent — Vite caches the module promise after the first call.
 */

let fileViewerWarm: Promise<unknown> | null = null
let officeWarm: Promise<unknown> | null = null

/** File canvas + its common deps (markdown preview path, etc.). */
export function prefetchFileViewer(): void {
  if (fileViewerWarm) return
  fileViewerWarm = import('../components/FileViewer').catch(() => {
    fileViewerWarm = null
  })
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
