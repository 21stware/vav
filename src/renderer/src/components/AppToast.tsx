import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useSessionStore, type ToastState } from '../state/sessionStore'
import { useT } from '../i18n/useT'

const LEAVE_MS = 180 // --dur-pop

/**
 * App-wide toast host: enter via @starting-style, exit before unmount
 * (auto-timeout and dismiss share the same leave path).
 */
export function AppToast(): React.JSX.Element | null {
  const t = useT()
  const toast = useSessionStore((s) => s.toast)
  const showToast = useSessionStore((s) => s.showToast)
  const [visible, setVisible] = useState<ToastState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const visibleRef = useRef<ToastState | null>(null)
  const leaveTimer = useRef<number | null>(null)

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }

    if (toast) {
      setLeaving(false)
      setVisible(toast)
      return
    }

    if (!visibleRef.current) {
      setVisible(null)
      setLeaving(false)
      return
    }

    setLeaving(true)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setVisible(null)
      setLeaving(false)
    }, LEAVE_MS)

    return () => {
      if (leaveTimer.current !== null) {
        window.clearTimeout(leaveTimer.current)
        leaveTimer.current = null
      }
    }
  }, [toast])

  if (!visible) return null

  const Icon =
    visible.kind === 'success' ? CheckCircle2 : visible.kind === 'error' ? AlertCircle : Info

  return (
    <div
      className={`app-toast kind-${visible.kind}`}
      data-leaving={leaving || undefined}
      role={visible.kind === 'error' ? 'alert' : 'status'}
      aria-live={visible.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="app-toast-icon" aria-hidden>
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="app-toast-copy">
        <div className="app-toast-title">{visible.title}</div>
        {visible.description && <div className="app-toast-body">{visible.description}</div>}
      </div>
      <button
        type="button"
        className="app-toast-dismiss"
        title={t('common.dismiss')}
        aria-label={t('common.dismiss')}
        onClick={() => {
          if (leaving) return
          showToast(null)
        }}
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
