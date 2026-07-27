import { useEffect, useState } from 'react'
import { Check, Download, FileCode2, Loader2, Terminal, XCircle } from 'lucide-react'
import type { CliInstallLocation, CliStatus } from '@shared/ipc'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, InlineAlert, Segmented } from '../ui'

function relativeInstalledAt(at: number | null, t: ReturnType<typeof useT>): string {
  if (!at) return ''
  const days = Math.round((Date.now() - at) / (24 * 60 * 60 * 1000))
  if (days <= 0) return t('time.today')
  if (days < 30) return t('time.daysAgo', { n: days })
  return t('time.monthsAgo', { n: Math.round(days / 30) })
}

function dirFor(location: CliInstallLocation): string {
  if (location === '~/.local/bin') return '/.local/bin/'
  return '/usr/local/bin/'
}

/**
 * Install / uninstall the `vav` shell command (settings-cli.rpml).
 */
export function CliSettings(): React.JSX.Element {
  const t = useT()
  const showDialog = useSessionStore((s) => s.showDialog)
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.vav.settings.cliStatus().then(setStatus)
  }, [])

  if (!status) return <div className="muted">{t('common.loading')}</div>

  const location = status.preferredLocation
  const targetLabel = `${location}/vav`
  const shouldMove =
    status.installed &&
    !!status.path &&
    !status.path.includes(dirFor(location))

  const setLocation = async (next: CliInstallLocation): Promise<void> => {
    setStatus(await window.vav.settings.cliSetLocation(next))
  }

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.vav.settings.cliInstall())
    } finally {
      setBusy(false)
    }
  }

  const uninstall = (): void => {
    showDialog({
      title: t('cli.uninstallTitle'),
      body: t('cli.uninstallBody', { path: status.path ?? targetLabel }),
      confirmLabel: t('cli.confirmUninstall'),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true)
          try {
            setStatus(await window.vav.settings.cliUninstall())
          } finally {
            setBusy(false)
          }
        })()
      }
    })
  }

  const installLabel = shouldMove
    ? t('cli.moveTo', { location })
    : busy
      ? t('common.installing')
      : status.error
        ? t('cli.retry')
        : t('common.install')

  const versionSuffix = status.version
    ? `（v${status.version}${
        status.installedAt ? ` · ${relativeInstalledAt(status.installedAt, t)}` : ''
      }）`
    : ''

  return (
    <div className="settings-form">
      <div className="cli-intro">
        <Terminal size={18} />
        <div>
          <div className="cli-intro-title">{t('cli.commandTitle')}</div>
          <div className="muted tiny">{t('cli.commandIntro')}</div>
        </div>
      </div>

      <div className="cli-status-row">
        {busy ? (
          <Loader2 className="spin" size={14} />
        ) : status.installed && !status.error ? (
          <Check size={14} />
        ) : status.error ? (
          <XCircle size={14} />
        ) : (
          <FileCode2 size={14} />
        )}
        <div className="cli-status-text">
          {busy ? (
            <span>{t('cli.installingTo', { path: targetLabel })}</span>
          ) : status.installed && status.path && !status.error ? (
            <>
              <div>
                {t('cli.installedAt', { path: status.path, version: versionSuffix })}
              </div>
              <div className="muted tiny">{t('cli.installedHint')}</div>
            </>
          ) : status.error ? (
            <span className="muted">{t('cli.installFailedPrefix', { message: status.error })}</span>
          ) : (
            <span className="muted">{t('cli.notInstalled', { path: targetLabel })}</span>
          )}
        </div>
        {status.installed && !shouldMove && !status.error ? (
          <Button
            label={t('common.uninstall')}
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={uninstall}
          />
        ) : (
          <Button
            label={installLabel}
            variant="primary"
            size="sm"
            icon={busy ? <Loader2 className="spin" size={12} /> : <Download size={12} />}
            disabled={busy}
            onClick={() => void install()}
          />
        )}
      </div>

      {!status.pathInPath && (
        <InlineAlert kind="warning" message={t('cli.pathWarning', { location })} />
      )}

      <div className="settings-section-title">{t('cli.installLocation')}</div>
      <Segmented
        value={location}
        onChange={(value) => void setLocation(value as CliInstallLocation)}
        options={[
          { value: '/usr/local/bin', label: '/usr/local/bin' },
          { value: '~/.local/bin', label: '~/.local/bin' }
        ]}
      />
      <p className="muted tiny">{t('cli.installLocationHint')}</p>

      <div className="settings-section-title">{t('cli.behaviorTitle')}</div>
      <ul className="cli-help">
        <li>{t('cli.help.dot')}</li>
        <li>{t('cli.help.path')}</li>
        <li>{t('cli.help.bare')}</li>
        <li>{t('cli.help.running')}</li>
        <li>{t('cli.nonBlocking')}</li>
      </ul>
    </div>
  )
}
