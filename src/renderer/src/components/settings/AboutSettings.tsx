import { Download, RefreshCw, RotateCw } from 'lucide-react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'
import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

export function AboutSettings(): React.JSX.Element {
  const t = useT()
  const about = useSessionStore((s) => s.about)
  const updateState = useSessionStore((s) => s.updateState)
  const resetSettings = useSessionStore((s) => s.resetSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)
  const checkForUpdates = useSessionStore((s) => s.checkForUpdates)
  const downloadUpdate = useSessionStore((s) => s.downloadUpdate)
  const installUpdate = useSessionStore((s) => s.installUpdate)
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
          icon={<RefreshCw size={14} />}
          label={checking ? t('about.checkingUpdates') : t('about.checkUpdates')}
          variant="secondary"
          disabled={checking || downloading}
          onClick={() => void checkForUpdates()}
        />
        {updateState.phase === 'available' ? (
          <Button
            icon={<Download size={14} />}
            label={t('update.availableButton', { version: updateState.latestVersion ?? '' })}
            variant="primary"
            onClick={() => void downloadUpdate()}
          />
        ) : null}
        {downloading ? (
          <Button
            icon={<Download size={14} />}
            label={t('update.downloading', { progress: updateState.progress })}
            variant="primary"
            disabled
          />
        ) : null}
        {updateState.phase === 'ready' ? (
          <Button
            icon={<RotateCw size={14} />}
            label={t('update.restartInstall')}
            variant="primary"
            onClick={() => void installUpdate()}
          />
        ) : null}
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
