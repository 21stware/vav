import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { LeafCompaction } from '@shared/types'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Quiet log after a manual compact.
 *
 * Originals stay in the normal transcript — this only notes that the model
 * path was compressed, with an optional plain-text summary (no chrome box).
 */
export function CompactionBanner({
  compaction,
  busy,
  onClear
}: {
  compaction: LeafCompaction
  busy: boolean
  onClear: () => void
}): React.JSX.Element {
  const t = useT()
  const [showSummary, setShowSummary] = useState(false)

  return (
    <div className="compaction-log" data-expanded={showSummary || undefined}>
      <div className="compaction-log-row">
        <button
          type="button"
          className="compaction-log-toggle"
          aria-expanded={showSummary}
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="compaction-log-title">
            {t('compact.logLine', { count: compaction.compactedCount })}
          </span>
        </button>
        <Button
          label={t('compact.restore')}
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onClear}
        />
      </div>
      {showSummary && (
        <pre className="compaction-log-summary">{compaction.summary}</pre>
      )}
    </div>
  )
}
