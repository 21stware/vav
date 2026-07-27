import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'
import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

export function AboutSettings(): React.JSX.Element {
  const t = useT()
  const about = useSessionStore((s) => s.about)
  const resetSettings = useSessionStore((s) => s.resetSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)

  return (
    <div className="about-card">
      <div>
        <span className="about-logo" role="img" aria-label="vav">
          <img className="logo-light" src={wordmark} alt="" />
          <img className="logo-dark" src={wordmarkDark} alt="" />
        </span>
        <div className="muted">{about?.version ?? '1.0.0'}</div>
      </div>

      <div>
        <div className="kv-row">
          <span className="kv-label">{t('about.dataLabel')}</span>
          <span className="kv-value">{t('about.dataValue')}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('about.terminalLabel')}</span>
          <span className="kv-value">{t('about.terminalValue')}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('about.networkLabel')}</span>
          <span className="kv-value">{t('about.networkValue')}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('about.recordsLabel')}</span>
          <span className="kv-value">{about?.conversationsPath ?? ''}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          label={t('about.viewShortcuts')}
          variant="secondary"
          onClick={() => setShortcutsOpen(true)}
        />
        <Button
          label={t('about.reset')}
          variant="danger"
          onClick={() =>
            showDialog({
              title: t('about.resetTitle'),
              body: t('about.resetBody'),
              confirmLabel: t('dialog.resetConfirm'),
              destructive: true,
              onConfirm: () => void resetSettings()
            })
          }
        />
      </div>
    </div>
  )
}
