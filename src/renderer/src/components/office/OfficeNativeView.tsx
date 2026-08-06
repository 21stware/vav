/**
 * Router for mature office/PDF renderers.
 *
 * Each format is a separate async chunk so opening a chat session (or a
 * markdown preview) never parses SheetJS / docx-preview / pdf.js.
 */

import { Suspense, lazy, useCallback } from 'react'
import type { FilePreviewKind } from '@shared/ipc'
import type { PreviewBlock } from '@shared/previewBlock'

const DocxNativeView = lazy(() =>
  import('./DocxNativeView').then((m) => ({ default: m.DocxNativeView }))
)
const PdfNativeView = lazy(() =>
  import('./PdfNativeView').then((m) => ({ default: m.PdfNativeView }))
)
const XlsxNativeView = lazy(() =>
  import('./XlsxNativeView').then((m) => ({ default: m.XlsxNativeView }))
)
const PptxNativeView = lazy(() =>
  import('./PptxNativeView').then((m) => ({ default: m.PptxNativeView }))
)

function OfficeFallback(): React.JSX.Element {
  return <div className="muted">…</div>
}

export function OfficeNativeView({
  path,
  kind,
  revision = 0,
  selecting,
  selectedIds,
  onPick
}: {
  path: string
  kind: FilePreviewKind
  /** Bump when the open file is rewritten so native renderers re-read disk. */
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
}): React.JSX.Element {
  const handle = useCallback(
    (block: PreviewBlock, event: MouseEvent) => {
      onPick(block, event)
    },
    [onPick]
  )

  let body: React.JSX.Element
  if (kind === 'docx') {
    body = (
      <DocxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  } else if (kind === 'pdf') {
    body = (
      <PdfNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  } else if (kind === 'xlsx') {
    body = (
      <XlsxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  } else if (kind === 'pptx') {
    body = (
      <PptxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  } else {
    return <div className="muted">Unsupported office kind</div>
  }

  return <Suspense fallback={<OfficeFallback />}>{body}</Suspense>
}
