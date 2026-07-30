/**
 * Router for mature office/PDF renderers.
 */

import { useCallback } from 'react'
import type { FilePreviewKind } from '@shared/ipc'
import type { PreviewBlock } from '@shared/previewBlock'
import { DocxNativeView } from './DocxNativeView'
import { PdfNativeView } from './PdfNativeView'
import { XlsxNativeView } from './XlsxNativeView'
import { PptxNativeView } from './PptxNativeView'

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

  if (kind === 'docx') {
    return (
      <DocxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  }
  if (kind === 'pdf') {
    return (
      <PdfNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  }
  if (kind === 'xlsx') {
    return (
      <XlsxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  }
  if (kind === 'pptx') {
    return (
      <PptxNativeView
        path={path}
        revision={revision}
        selecting={selecting}
        selectedIds={selectedIds}
        onPick={handle}
      />
    )
  }
  return <div className="muted">Unsupported office kind</div>
}
