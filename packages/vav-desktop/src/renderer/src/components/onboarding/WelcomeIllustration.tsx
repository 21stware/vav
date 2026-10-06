import { useT } from '../../i18n/useT'

/**
 * The window in miniature: sessions, the agent conversation with a pending
 * diff, and the app column. Drawn with tokens so it follows theme and accent.
 */
export function WelcomeIllustration(): React.JSX.Element {
  const t = useT()
  return (
    <figure className="onboarding-illo" aria-hidden>
      <div className="onboarding-illo-window">
        <div className="onboarding-illo-col is-list">
          <span className="onboarding-illo-row is-active" />
          <span className="onboarding-illo-row" />
          <span className="onboarding-illo-row is-short" />
          <span className="onboarding-illo-row" />
        </div>
        <div className="onboarding-illo-col is-agent">
          <span className="onboarding-illo-bubble" />
          <span className="onboarding-illo-line" />
          <span className="onboarding-illo-line is-short" />
          <span className="onboarding-illo-diff">
            <span className="is-del" />
            <span className="is-add" />
            <span className="is-add is-short" />
          </span>
          <span className="onboarding-illo-composer" />
        </div>
        <div className="onboarding-illo-col is-apps">
          <span className="onboarding-illo-card">
            <span className="onboarding-illo-line" />
            <span className="onboarding-illo-line is-short" />
          </span>
          <span className="onboarding-illo-file" />
          <span className="onboarding-illo-file" />
        </div>
      </div>
      <figcaption className="onboarding-illo-labels">
        <span>{t('onboarding.welcome.colSessions')}</span>
        <span>{t('onboarding.welcome.colAgent')}</span>
        <span>{t('onboarding.welcome.colApps')}</span>
      </figcaption>
    </figure>
  )
}
