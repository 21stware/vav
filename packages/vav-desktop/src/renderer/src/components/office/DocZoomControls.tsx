/**
 * Bottom-right zoom chrome for document stages. Sibling of {@link PagePager}:
 * same pill, opposite corner. Idles at low opacity until the stage is hovered,
 * and stays lit whenever the document is off fit-to-width.
 */

import { Minus, Plus } from 'lucide-react'
import { DOC_ZOOM_MAX } from '../../lib/docZoom'
import { useT } from '../../i18n/useT'

/** One button press. Matches the diagram canvas so zoom feels the same app-wide. */
export const DOC_ZOOM_STEP = 1.25

export function DocZoomControls({
  scale,
  atFit,
  onZoomIn,
  onZoomOut,
  onFit,
  disabled,
  minScale,
  maxScale = DOC_ZOOM_MAX,
  resetKey = 'preview.actualSize'
}: {
  scale: number
  atFit: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  disabled?: boolean
  /**
   * Zoom floor. Paged stages leave it unset: fit *is* their floor, so the minus
   * key goes dead there. Text zoom sets one, because reading below 100% is a
   * real thing to want.
   */
  minScale?: number
  maxScale?: number
  /** What the readout button does — fit the page, or return to 100%. */
  resetKey?: 'preview.fitWidth' | 'preview.actualSize'
}): React.JSX.Element | null {
  const t = useT()
  if (disabled) return null

  const resetLabel = t(resetKey)
  return (
    <div className="doc-zoom-controls" data-off-fit={atFit ? 'false' : 'true'}>
      <button
        type="button"
        className="doc-zoom-step"
        disabled={minScale != null ? scale <= minScale + 0.001 : atFit}
        aria-label={t('preview.zoomOut')}
        title={t('preview.zoomOut')}
        onClick={onZoomOut}
      >
        <Minus size={13} strokeWidth={2.25} aria-hidden />
      </button>
      <button
        type="button"
        className="doc-zoom-readout"
        aria-label={resetLabel}
        title={resetLabel}
        onClick={onFit}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        className="doc-zoom-step"
        disabled={scale >= maxScale - 0.001}
        aria-label={t('preview.zoomIn')}
        title={t('preview.zoomIn')}
        onClick={onZoomIn}
      >
        <Plus size={13} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  )
}
