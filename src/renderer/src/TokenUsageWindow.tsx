import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppLocale, ThemeMode } from '@shared/types'
import type { TokenUsageViewPayload } from '@shared/ipc'
import { t as translate, type MessageKey, type TParams } from '@shared/i18n'
import { TokenUsagePanel } from './components/TokenUsagePanel'

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
 * Native panel popup for context-window / token usage details.
 *
 * Intentionally lean: no sessionStore bootstrap, no settings bridge, no
 * conversation list. Main hydrates via `onTokenUsageView` and reuses the
 * BrowserWindow (hide, don't destroy) so reopening is instant.
 */
export default function TokenUsageWindow({
  conversationId: _initialId
}: {
  conversationId: string
}): React.JSX.Element {
  const [payload, setPayload] = useState<TokenUsageViewPayload | null>(null)

  // First paint: match native chrome so we never flash system white.
  useEffect(() => {
    paintShell('system')
  }, [])

  useEffect(() => {
    const apply = (next: TokenUsageViewPayload): void => {
      setPayload(next)
      paintShell(next.theme)
      document.title = translate(next.locale, 'token.contextWindow')
    }
    const pull = (): void => {
      void window.vav.window.getTokenUsageView().then((next) => {
        if (next) apply(next)
      })
    }
    const off = window.vav.window.onTokenUsageView(apply)
    // Pull after subscribe — open() may have pushed before this effect ran
    // (warm shell + React StrictMode remount race → stuck on Loading).
    // Also re-pull on focus/visibility: the shell is reused (hide, not destroy).
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

  // Follow system theme flips while open when preference is `system`.
  useEffect(() => {
    if (!payload || payload.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => paintShell('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [payload?.theme])

  const t = useCallback(
    (key: MessageKey, params?: TParams) =>
      translate((payload?.locale ?? 'zh-CN') as AppLocale, key, params),
    [payload?.locale]
  )

  const locale = (payload?.locale ?? 'zh-CN') as AppLocale

  const body = useMemo(() => {
    if (!payload) {
      return <div className="token-usage-popup-body muted">{t('common.loading')}</div>
    }
    return (
      <div className="token-usage-popup-body">
        <TokenUsagePanel
          payload={payload}
          t={t}
          locale={locale}
          onPayloadPatch={(patch) => setPayload((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      </div>
    )
  }, [payload, t, locale])

  return (
    <div className="token-usage-popup" data-testid="token-usage-window">
      <div className="token-usage-popup-title">{t('token.contextWindow')}</div>
      {body}
    </div>
  )
}
