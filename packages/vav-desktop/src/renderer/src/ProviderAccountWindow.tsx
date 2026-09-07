import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppLocale, ThemeMode } from '@shared/types'
import type { ProviderAccountViewPayload } from '@shared/ipc'
import { t as translate, type MessageKey, type TParams } from '@shared/i18n'
import { ProviderAccountPanel } from './components/ProviderAccountPanel'

const BG = { dark: '#121213', light: '#ececee' } as const

function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Paint solid window fill before React content — matches BrowserWindow.backgroundColor. */
function paintShell(theme: ThemeMode | 'light' | 'dark' = 'dark'): void {
  const resolved = theme === 'light' || theme === 'dark' ? theme : resolveTheme(theme)
  const bg = BG[resolved]
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.background = bg
  document.body.style.background = bg
  const root = document.getElementById('root')
  if (root) root.style.background = bg
}

/**
 * Native panel popup for the locked provider mark (account + quota).
 *
 * Same lean shell as Token Usage: no sessionStore bootstrap. Main hydrates
 * via `onProviderAccountView` and reuses the BrowserWindow (hide, don't destroy).
 */
export default function ProviderAccountWindow({
  conversationId: _initialId
}: {
  conversationId: string
}): React.JSX.Element {
  const [payload, setPayload] = useState<ProviderAccountViewPayload | null>(null)

  useEffect(() => {
    paintShell('system')
  }, [])

  useEffect(() => {
    const apply = (next: ProviderAccountViewPayload): void => {
      setPayload(next)
      paintShell(next.theme)
      document.title = translate(next.locale, 'composer.accountTitle')
    }
    const pull = (): void => {
      void window.vav.window.getProviderAccountView().then((next) => {
        if (next) apply(next)
      })
    }
    const off = window.vav.window.onProviderAccountView(apply)
    pull()
    const onFocus = (): void => pull()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') pull()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!payload || payload.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => paintShell('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [payload?.theme])

  const rootRef = useRef<HTMLDivElement>(null)
  const lastFit = useRef(0)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      if (height <= 0 || height === lastFit.current) return
      lastFit.current = height
      void window.vav.window.fitProviderAccount(height)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [payload])

  const t = useCallback(
    (key: MessageKey, params?: TParams) =>
      translate((payload?.locale ?? 'zh-CN') as AppLocale, key, params),
    [payload?.locale]
  )

  const body = useMemo(() => {
    if (!payload) {
      return <div className="token-usage-popup-body muted">{t('common.loading')}</div>
    }
    return (
      <div className="token-usage-popup-body">
        <ProviderAccountPanel payload={payload} t={t} />
      </div>
    )
  }, [payload, t])

  return (
    <div ref={rootRef} className="token-usage-popup provider-account-popup">
      <div className="token-usage-popup-title">{t('composer.accountTitle')}</div>
      {body}
    </div>
  )
}
