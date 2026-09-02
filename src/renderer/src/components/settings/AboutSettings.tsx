import { useEffect } from 'react'
import { ChevronDown, Download, LoaderCircle, RefreshCw, RotateCw } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import {
  AUTO_UPDATE_POLICIES,
  resolveAutoUpdatePolicy,
  type AutoUpdatePolicy
} from '@shared/updatePolicy'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

const POLICY_LABEL: Record<AutoUpdatePolicy, MessageKey> = {
  off: 'about.autoUpdatePolicy.off',
  notify: 'about.autoUpdatePolicy.notify',
  download: 'about.autoUpdatePolicy.download',
  auto: 'about.autoUpdatePolicy.auto'
}

const POLICY_HINT: Record<AutoUpdatePolicy, MessageKey> = {
  off: 'about.autoUpdatePolicyHint.off',
  notify: 'about.autoUpdatePolicyHint.notify',
  download: 'about.autoUpdatePolicyHint.download',
  auto: 'about.autoUpdatePolicyHint.auto'
}
import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

export function AboutSettings(): React.JSX.Element {
  const t = useT()
  const about = useSessionStore((s) => s.about)
  const settings = useSessionStore((s) => s.settings)
  const updateState = useSessionStore((s) => s.updateState)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const resetSettings = useSessionStore((s) => s.resetSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const openSettings = useSessionStore((s) => s.openSettings)
  const checkForUpdates = useSessionStore((s) => s.checkForUpdates)
  const downloadUpdate = useSessionStore((s) => s.downloadUpdate)
  const installUpdate = useSessionStore((s) => s.installUpdate)
  const phase = updateState.phase
  const latestVersion = updateState.latestVersion
  const checking = phase === 'checking'
  const transferring = phase === 'downloading' || phase === 'preparing'
  const canDownload = phase === 'available'
  const canRestart = phase === 'ready'
  const showLatestRow =
    !!latestVersion &&
    (phase === 'available' ||
      phase === 'downloading' ||
      phase === 'preparing' ||
      phase === 'ready')
  const releaseUrl = updateState.releaseUrl
  const autoUpdatePolicy = resolveAutoUpdatePolicy(settings)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const current = await window.vav.updates.getState().catch(() => null)
      if (cancelled) return
      if (current) useSessionStore.setState({ updateState: current })
      const nextPhase = current?.phase ?? useSessionStore.getState().updateState.phase
      if (
        nextPhase === 'checking' ||
        nextPhase === 'downloading' ||
        nextPhase === 'preparing' ||
        nextPhase === 'ready'
      ) {
        return
      }
      if (resolveAutoUpdatePolicy(useSessionStore.getState().settings) === 'off') return
      if (nextPhase === 'idle') await useSessionStore.getState().checkForUpdates()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="about-stack">
      <div className="about-brand">
        <span className="about-logo" role="img" aria-label="VAV">
          <img className="logo-light" src={wordmark} alt="" />
          <img className="logo-dark" src={wordmarkDark} alt="" />
        </span>
        <div className="muted">{t('about.subtitle')}</div>
      </div>

      <div className="about-meta">
        <div className="kv-row">
          <span className="kv-label">{t('about.currentVersion')}</span>
          <span className="kv-value" data-testid="settings-about-version">
            {about?.version ?? '—'}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('about.buildNumber')}</span>
          <span className="kv-value">{about?.buildNumber ?? '—'}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('about.license')}</span>
          <span className="kv-value" data-testid="settings-about-license">
            {t('about.licenseValue')}
          </span>
        </div>
      </div>

      <div className="about-section">
        <div className="settings-section-title">{t('about.updatesSection')}</div>
        <div className="form-row">
          <label htmlFor="settings-auto-update-policy">{t('about.autoUpdatePolicy')}</label>
          <div className="control">
            <div className="font-select">
              <select
                id="settings-auto-update-policy"
                className="text-field font-select-field"
                data-testid="settings-auto-update-policy"
                value={autoUpdatePolicy}
                title={t('about.autoUpdatePolicy')}
                onChange={(event) => {
                  const next = event.target.value as AutoUpdatePolicy
                  void updateSettings({ autoUpdatePolicy: next })
                }}
              >
                {AUTO_UPDATE_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {t(POLICY_LABEL[policy])}
                  </option>
                ))}
              </select>
              <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
            </div>
          </div>
        </div>
        <div className="form-hint">{t(POLICY_HINT[autoUpdatePolicy])}</div>

        {showLatestRow ? (
          <div className="kv-row">
            <span className="kv-label">{t('about.latestVersion')}</span>
            <span className="kv-value">v{latestVersion}</span>
          </div>
        ) : null}
        {checking ? (
          <div
            className="about-update-progress"
            aria-live="polite"
            data-testid="settings-about-update-checking"
          >
            <div className="about-update-progress-meta is-checking">
              <LoaderCircle size={13} strokeWidth={2} className="update-corner-spin" aria-hidden />
              <span>{t('about.checkingUpdates')}</span>
            </div>
            <div className="update-corner-track is-indeterminate" aria-hidden>
              <div className="update-corner-fill" />
            </div>
          </div>
        ) : null}
        {phase === 'available' ? (
          <div className="form-hint">{t('about.updateAvailableHint')}</div>
        ) : null}
        {phase === 'downloading' ? (
          <div className="about-update-progress" aria-live="polite">
            <div className="about-update-progress-meta">
              <span>{t('update.downloading', { progress: updateState.progress })}</span>
              <span>
                {t('update.downloadSpeed', {
                  speed: formatSpeed(updateState.bytesPerSecond ?? 0)
                })}
              </span>
            </div>
            <div className="update-corner-track" aria-hidden>
              <div
                className="update-corner-fill"
                style={{ width: `${Math.max(0, Math.min(100, updateState.progress))}%` }}
              />
            </div>
          </div>
        ) : null}
        {phase === 'preparing' ? (
          <div className="about-update-progress" aria-live="polite">
            <div className="form-hint">{t('update.preparing')}</div>
            <div className="form-hint">{t('update.preparingHint')}</div>
            <div className="update-corner-track is-indeterminate" aria-hidden>
              <div className="update-corner-fill" />
            </div>
          </div>
        ) : null}
        {phase === 'ready' ? (
          <div className="form-hint">
            {t('about.updateReadyHint', { version: latestVersion ?? '' })}
          </div>
        ) : null}

        <div className="about-actions">
          <Button
            icon={<RefreshCw size={14} />}
            label={checking ? t('about.checkingUpdates') : t('about.checkUpdates')}
            variant="secondary"
            disabled={checking || transferring}
            onClick={() => void checkForUpdates()}
          />
          {canDownload ? (
            <Button
              icon={<Download size={14} />}
              label={t('update.availableButton', { version: latestVersion ?? '' })}
              variant="primary"
              onClick={() => void downloadUpdate()}
            />
          ) : null}
          {canRestart ? (
            <Button
              icon={<RotateCw size={14} />}
              label={t('update.restartInstall')}
              variant="primary"
              onClick={() => void installUpdate()}
            />
          ) : null}
          {releaseUrl && (canDownload || canRestart || phase === 'latest') ? (
            <Button
              label={t('about.updateReleaseNotes')}
              variant="ghost"
              onClick={() => window.open(releaseUrl, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        {phase === 'latest' ? (
          <div className="form-hint" aria-live="polite">
            {t('update.toastLatestBody', {
              version: latestVersion ?? about?.version ?? ''
            })}
          </div>
        ) : null}
        {phase === 'error' ? (
          <div className="form-hint about-update-error" role="alert">
            {updateState.message?.trim() || t('update.toastErrorBody')}
          </div>
        ) : null}
      </div>

      <div className="about-actions">
        <Button
          label={t('about.viewShortcuts')}
          variant="secondary"
          onClick={() => openSettings('keybindings')}
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
