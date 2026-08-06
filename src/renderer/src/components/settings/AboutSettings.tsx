import { RefreshCw } from 'lucide-react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Toggle } from '../ui'
import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

export function AboutSettings(): React.JSX.Element {
  const t = useT()
  const about = useSessionStore((s) => s.about)
  const settings = useSessionStore((s) => s.settings)
  const updateState = useSessionStore((s) => s.updateState)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const resetSettings = useSessionStore((s) => s.resetSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)
  const checkForUpdates = useSessionStore((s) => s.checkForUpdates)
  const checking = updateState.phase === 'checking'
  const downloading = updateState.phase === 'downloading'

  return (
    <div className="about-stack">
      <div className="about-card">
        <div>
          <span className="about-logo" role="img" aria-label="VAV">
            <img className="logo-light" src={wordmark} alt="" />
            <img className="logo-dark" src={wordmarkDark} alt="" />
          </span>
          <div className="muted">{t('about.subtitle')}</div>
        </div>
        <div>
          <div className="kv-row">
            <span className="kv-label">{t('about.currentVersion')}</span>
            <span className="kv-value">{about?.version ?? '—'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">{t('about.buildNumber')}</span>
            <span className="kv-value">{about?.buildNumber ?? '—'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">{t('about.license')}</span>
            <span className="kv-value">{t('about.licenseValue')}</span>
          </div>
        </div>
      </div>

      <div className="about-card">
        <div className="about-card-title">{t('about.updatesSection')}</div>
        <div className="form-row">
          <label>{t('about.autoCheckUpdates')}</label>
          <div className="control">
            <Toggle
              checked={settings.autoCheckUpdates}
              title={t('about.autoCheckUpdates')}
              onChange={(autoCheckUpdates) => void updateSettings({ autoCheckUpdates })}
            />
          </div>
        </div>
        <div className="form-hint">{t('about.autoCheckUpdatesHint')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Button
            icon={<RefreshCw size={14} />}
            label={checking ? t('about.checkingUpdates') : t('about.checkUpdates')}
            variant="secondary"
            disabled={checking || downloading}
            onClick={() => void checkForUpdates()}
          />
        </div>
        {updateState.phase === 'available' ||
        updateState.phase === 'downloading' ||
        updateState.phase === 'ready' ? (
          <div className="form-hint" style={{ marginTop: 8 }}>
            {t('about.updateCornerHint')}
          </div>
        ) : null}
      </div>

      <div className="about-card">
        <div className="about-card-title">{t('about.dataSecurity')}</div>
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
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
