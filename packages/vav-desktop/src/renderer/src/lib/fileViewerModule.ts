/**
 * FileViewer stays code-split, but a warm preview shell has already loaded it
 * long before a path arrives. Routing it through `React.lazy` anyway makes the
 * Suspense boundary flash a fallback, and React throttles fallback→content
 * reveals by ~300 ms — which was the entire cost of a warm open.
 *
 * Hand the component over synchronously whenever the module is in memory.
 */

import type { FileViewer } from '../components/FileViewer'

type FileViewerComponent = typeof FileViewer

let loaded: FileViewerComponent | null = null
let pending: Promise<FileViewerComponent> | null = null

/** Non-null once the chunk has been evaluated in this window. */
export function loadedFileViewer(): FileViewerComponent | null {
  return loaded
}

export function loadFileViewer(): Promise<FileViewerComponent> {
  pending ??= import('../components/FileViewer').then((m) => {
    loaded = m.FileViewer
    return m.FileViewer
  })
  return pending
}
