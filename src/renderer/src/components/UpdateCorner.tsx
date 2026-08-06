import { Download, RotateCw } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

/**
 * Bottom-left update affordance: available → download → speed → restart.
 * `inline` sits in the sidebar foot; `fixed` covers the window when the
 * sidebar is hidden.
 */
export function UpdateCorner({
  variant = 'fixed'
}: {
  variant?: 'fixed' | 'inline'
} = {}): React.JSX.Element | null {
  const t = useT()
  const phase = useSessionStore((s) => s.updateState.phase)
  const latestVersion = useSessionStore((s) => s.updateState.latestVersion)
  const progress = useSessionStore((s) => s.updateState.progress)
  const bytesPerSecond = useSessionStore((s) => s.updateState.bytesPerSecond)
  const downloadUpdate = useSessionStore((s) => s.downloadUpdate)
  const installUpdate = useSessionStore((s) => s.installUpdate)

  if (phase !== 'available' && phase !== 'downloading' && phase !== 'ready') {
    return null
  }

  const body =
    phase === 'available' ? (
      <button
        type="button"
        className="update-corner-btn"
        onClick={() => void downloadUpdate()}
      >
        <Download size={13} strokeWidth={2} aria-hidden />
        <span>{t('update.availableButton', { version: latestVersion ?? '' })}</span>
      </button>
    ) : phase === 'downloading' ? (
      <div className="update-corner-progress" aria-live="polite">
        <div className="update-corner-progress-meta">
          <Download size={13} strokeWidth={2} aria-hidden />
          <span>{t('update.downloading', { progress })}</span>
          <span className="update-corner-speed">
            {t('update.downloadSpeed', {
              speed: formatSpeed(bytesPerSecond ?? 0)
            })}
          </span>
        </div>
        <div className="update-corner-track" aria-hidden>
          <div
            className="update-corner-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      </div>
    ) : (
      <button
        type="button"
        className="update-corner-btn is-ready"
        onClick={() => void installUpdate()}
      >
        <RotateCw size={13} strokeWidth={2} aria-hidden />
        <span>{t('update.restartInstall')}</span>
      </button>
    )

  if (variant === 'inline') {
    return (
      <div className="sidebar-update-slot" role="status">
        <div className="update-corner is-inline">{body}</div>
      </div>
    )
  }

  return (
    <div className="update-corner" role="status">
      {body}
    </div>
  )
}
