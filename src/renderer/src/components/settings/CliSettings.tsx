import { useEffect, useState } from 'react'
import { Check, Download, FileCode2, Loader2, Terminal, XCircle } from 'lucide-react'
import type { CliStatus } from '@shared/ipc'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, InlineAlert } from '../ui'

function relativeInstalledAt(at: number | null, t: ReturnType<typeof useT>): string {
  if (!at) return ''
  const days = Math.round((Date.now() - at) / (24 * 60 * 60 * 1000))
  if (days <= 0) return t('time.today')
  if (days < 30) return t('time.daysAgo', { n: days })
  return t('time.monthsAgo', { n: Math.round(days / 30) })
}

/**
 * Install / uninstall the `vav` shell command (settings-cli.rpml).
 *
 * Mount paints the page shell immediately; status (and the login-PATH probe)
 * loads in the background so switching to this tab never freezes Settings.
 */
export function CliSettings(): React.JSX.Element {
  const t = useT()
  const showDialog = useSessionStore((s) => s.showDialog)
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void window.vav.settings
      .cliStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setLoadError(message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const location = status?.preferredLocation ?? '~/.local/bin'
  const targetLabel = `${location}/vav`

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.vav.settings.cliInstall())
    } finally {
      setBusy(false)
    }
  }

  const uninstall = (): void => {
    if (!status) return
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

  const installLabel = busy
    ? t('common.installing')
    : status?.error
      ? t('cli.retry')
      : t('common.install')

  const versionSuffix =
    status?.version
      ? `（v${status.version}${
          status.installedAt ? ` · ${relativeInstalledAt(status.installedAt, t)}` : ''
        }）`
      : ''

  const loading = !status && !loadError

  return (
    <div className="settings-form">
      <div className="cli-intro">
        <Terminal size={18} />
        <div>
          <div className="cli-intro-title">{t('cli.commandTitle')}</div>
          <div className="muted tiny">{t('cli.commandIntro')}</div>
        </div>
      </div>

      <div className="cli-status-row" aria-busy={loading || busy}>
        {loading || busy ? (
          <Loader2 className="spin" size={14} />
        ) : status?.installed && !status.error ? (
          <Check size={14} />
        ) : status?.error || loadError ? (
          <XCircle size={14} />
        ) : (
          <FileCode2 size={14} />
        )}
        <div className="cli-status-text">
          {loading ? (
            <span className="muted">{t('common.loading')}</span>
          ) : loadError ? (
            <span className="muted">{t('cli.installFailedPrefix', { message: loadError })}</span>
          ) : busy ? (
            <span>{t('cli.installingTo', { path: targetLabel })}</span>
          ) : status?.installed && status.path && !status.error ? (
            <>
              <div>
                {t('cli.installedAt', { path: status.path, version: versionSuffix })}
              </div>
              <div className="muted tiny">{t('cli.installedHint')}</div>
            </>
          ) : status?.error ? (
            <span className="muted">
              {t('cli.installFailedPrefix', { message: status.error })}
            </span>
          ) : (
            <span className="muted">{t('cli.notInstalled', { path: targetLabel })}</span>
          )}
        </div>
        {!loading && !loadError && status ? (
          status.installed && !status.error ? (
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
          )
        ) : null}
      </div>

      {status?.notice ? <InlineAlert kind="success" message={status.notice} /> : null}

      {status && !status.pathInPath ? (
        <InlineAlert kind="warning" message={t('cli.pathWarning', { location })} />
      ) : null}

      <p className="muted tiny">{t('cli.afterInstallHint')}</p>
    </div>
  )
}
