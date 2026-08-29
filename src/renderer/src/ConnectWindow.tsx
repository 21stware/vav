import { useCallback, useEffect } from 'react'
import {
  installHostsBridge,
  installSettingsBridge,
  useSessionStore
} from './state/sessionStore'
import { useT } from './i18n/useT'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { ConnectSettings } from './components/settings/ConnectSettings'

/**
 * Sidebar Connect popup: phone QR + vavd machine pairing in a small window of
 * its own. Same light store bootstrap as Settings — no transcript loading.
 */
export default function ConnectWindow(): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap(undefined, { light: true })
  }, [bootstrap])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offHosts = installHostsBridge()
    const offMenu = installDefaultContextMenu()
    return () => {
      offSettings()
      offHosts()
      offMenu()
    }
  }, [])

  useAppearance()

  const close = useCallback((): void => {
    void window.vav.window.closeConnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!ready) return <div className="connect-window" />

  return (
    <div className="connect-window" data-testid="connect-window">
      <header className="settings-head connect-head">{t('settings.nav.connect')}</header>
      <div className="settings-body connect-body">
        <ConnectSettings />
      </div>
    </div>
  )
}
