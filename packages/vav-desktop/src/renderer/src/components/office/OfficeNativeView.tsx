/**
 * Router for mature office/PDF renderers.
 *
 * Each format is a separate async chunk so opening a chat session (or a
 * markdown preview) never parses SheetJS / docx-preview / pdf.js.
 */

import { useCallback } from 'react'
import type { FilePreviewKind } from '@shared/ipc'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument } from '@shared/structuredDoc'
import { docxCanvas, pdfCanvas, pptxCanvas, xlsxCanvas } from './officeCanvases'

function OfficeFallback(): React.JSX.Element {
  return <div className="muted">…</div>
}

export function OfficeNativeView({
  path,
  kind,
  revision = 0,
  selecting,
  selectedIds,
  onPick,
  onReady,
  progressiveStructured
}: {
  path: string
  kind: FilePreviewKind
  /** Bump when the open file is rewritten so native renderers re-read disk. */
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
  /** Fired once the format canvas has painted first content. */
  onReady?: () => void
  /** Optional first-chunk structured doc (xlsx may seed grid). */
  progressiveStructured?: StructuredDocument | null
}): React.JSX.Element {
  const handle = useCallback(
    (block: PreviewBlock, event: MouseEvent) => {
      onPick(block, event)
    },
    [onPick]
  )

  // Hooks run for every kind; only the matching chunk is ever requested.
  const DocxNativeView = docxCanvas.use(kind === 'docx')
  const PdfNativeView = pdfCanvas.use(kind === 'pdf')
  const XlsxNativeView = xlsxCanvas.use(kind === 'xlsx')
  const PptxNativeView = pptxCanvas.use(kind === 'pptx')

  if (kind === 'docx') {
    if (!DocxNativeView) return <OfficeFallback />
    return (
      <DocxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
        onReady={onReady}
      />
    )
  }
  if (kind === 'pdf') {
    if (!PdfNativeView) return <OfficeFallback />
    return (
      <PdfNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
        onReady={onReady}
      />
    )
  }
  if (kind === 'xlsx') {
    if (!XlsxNativeView) return <OfficeFallback />
    return (
      <XlsxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
        onReady={onReady}
        seedStructured={progressiveStructured}
      />
    )
  }
  if (kind === 'pptx') {
    if (!PptxNativeView) return <OfficeFallback />
    return (
      <PptxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
        onReady={onReady}
      />
    )
  }
  return <div className="muted">Unsupported office kind</div>
}
