/**
 * Bottom-center page chrome for multi-page document canvases (PDF / DOCX / PPTX).
 * Compact: ‹  19 / 100  › — scroll-driven index, click to step.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useT } from '../../i18n/useT'

export function PagePager({
  current,
  total,
  onPrev,
  onNext,
  disabled
}: {
  /** 1-based page index */
  current: number
  total: number
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
}): React.JSX.Element | null {
  const t = useT()
  if (total <= 1 || disabled) return null

  const cur = Math.min(total, Math.max(1, current))
  const atStart = cur <= 1
  const atEnd = cur >= total

  return (
    <div className="doc-page-pager" role="navigation" aria-label={t('preview.pageNav')}>
      <button
        type="button"
        className="doc-page-pager-step"
        disabled={atStart}
        aria-label={t('preview.prevPage')}
        title={t('preview.prevPage')}
        onClick={onPrev}
      >
        <ChevronLeft size={14} strokeWidth={2.25} aria-hidden />
      </button>
      <span className="doc-page-pager-count" aria-live="polite" aria-atomic="true">
        {t('preview.pageOf', { current: String(cur), total: String(total) })}
      </span>
      <button
        type="button"
        className="doc-page-pager-step"
        disabled={atEnd}
        aria-label={t('preview.nextPage')}
        title={t('preview.nextPage')}
        onClick={onNext}
      >
        <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  )
}
