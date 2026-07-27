/**
 * Footer under the agent turn: flip-book mark + shimmer while live;
 * settled mark + Done when sealed.
 */
import doneMark from '../assets/loading/done.png'
import loadingSprite from '../assets/loading/sprite.png'
import { useT } from '../i18n/useT'

export function StreamStatus({
  state
}: {
  state: 'outputting' | 'done'
}): React.JSX.Element {
  const t = useT()

  if (state === 'done') {
    return (
      <div className="stream-status" data-state="done">
        <span className="stream-status-mark" data-static aria-hidden>
          <img src={doneMark} alt="" draggable={false} />
        </span>
        {t('stream.done')}
      </div>
    )
  }

  return (
    <div className="stream-status" data-state="outputting">
      <span className="stream-status-mark" aria-hidden>
        <img className="stream-status-mark-sprite" src={loadingSprite} alt="" draggable={false} />
      </span>
      <span className="stream-status-shimmer">{t('stream.outputting')}</span>
    </div>
  )
}
