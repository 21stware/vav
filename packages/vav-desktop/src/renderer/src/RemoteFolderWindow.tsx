import { useCallback, useEffect, useState } from 'react'
import type { AppLocale, ThemeMode } from '@shared/types'
import type { RemoteFolderViewPayload } from '@shared/ipc'
import { t as translate, type MessageKey, type TParams } from '@shared/i18n'
import { RemoteFolderPickerChrome } from './components/RemoteFolderPickerChrome'
import { installDefaultContextMenu } from './lib/nativeMenu'

const BG = { dark: '#121213', light: '#ececee' } as const

function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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
 * Native modal folder dialog for a remote host.
 *
 * Lean shell: no sessionStore bootstrap. Main hydrates via `onRemoteFolderView`.
 */
export default function RemoteFolderWindow(): React.JSX.Element {
  const [payload, setPayload] = useState<RemoteFolderViewPayload | null>(null)

  useEffect(() => {
    paintShell('system')
    return installDefaultContextMenu()
  }, [])

  useEffect(() => {
    const apply = (next: RemoteFolderViewPayload): void => {
      setPayload(next)
      paintShell(next.theme)
      document.title = translate(next.locale, 'hosts.pickTitle', { name: next.hostName })
    }
    const pull = (): void => {
      void window.vav.window.getRemoteFolderView?.().then((next) => {
        if (next) apply(next)
      })
    }
    const off = window.vav.window.onRemoteFolderView?.(apply)
    pull()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.vav.window.chooseRemoteFolder?.(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      off?.()
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

  const t = useCallback(
    (key: MessageKey, params?: TParams) =>
      translate((payload?.locale ?? 'zh-CN') as AppLocale, key, params),
    [payload?.locale]
  )

  if (!payload) {
    return <div className="remote-folder-window" data-testid="remote-folder-window" />
  }

  return (
    <RemoteFolderPickerChrome
      key={`${payload.machineId}:${payload.conversationId}:${payload.purpose}`}
      variant="window"
      machineId={payload.machineId}
      hostName={payload.hostName}
      recents={payload.recents}
      homeSeed={payload.home}
      fileViewMode={payload.fileViewMode}
      t={t}
      onCancel={() => void window.vav.window.chooseRemoteFolder?.(null)}
      onConfirm={(path) => void window.vav.window.chooseRemoteFolder?.(path)}
    />
  )
}
