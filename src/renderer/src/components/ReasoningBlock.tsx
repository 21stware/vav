import { useState } from 'react'
import { useT } from '../i18n/useT'

/**
 * Collapsed-by-default reasoning row (tool-expand-collapse.rpml).
 * Body opens with the same grid-rows bridge as tool cards.
 */
export function ReasoningBlock({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="reasoning" data-open={open || undefined}>
      <button
        type="button"
        className="reasoning-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('composer.thinking')}
      </button>
      <div className="reasoning-detail" aria-hidden={!open}>
        <div className="reasoning-detail-inner">
          <div className="reasoning-body">{text}</div>
        </div>
      </div>
    </div>
  )
}
