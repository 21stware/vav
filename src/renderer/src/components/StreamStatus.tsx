/**
 * Conversation-level stream mark: flip-book + shimmer while live;
 * one settled Done after the last sealed assistant turn.
 *
 * Light/dark spirit strips ship as separate assets (no CSS invert) so the
 * dark sheet can keep its own gray ink.
 */
import doneMark from '../assets/loading/done.png'
import doneMarkDark from '../assets/loading/dark-done.png'
import loadingSprite from '../assets/loading/sprite.png'
import loadingSpriteDark from '../assets/loading/dark-sprite.png'
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
          <img className="logo-light" src={doneMark} alt="" draggable={false} />
          <img className="logo-dark" src={doneMarkDark} alt="" draggable={false} />
        </span>
        {t('stream.done')}
      </div>
    )
  }

  return (
    <div className="stream-status" data-state="outputting">
      <span className="stream-status-mark" aria-hidden>
        <img
          className="stream-status-mark-sprite logo-light"
          src={loadingSprite}
          alt=""
          draggable={false}
        />
        <img
          className="stream-status-mark-sprite logo-dark"
          src={loadingSpriteDark}
          alt=""
          draggable={false}
        />
      </span>
      <span className="stream-status-shimmer">{t('stream.outputting')}</span>
    </div>
  )
}
