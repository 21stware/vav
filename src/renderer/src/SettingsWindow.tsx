import { useCallback, useEffect } from 'react'
import { Bell, Bot, FileCheck2, Folder, Info, KeyRound, Palette, Terminal } from 'lucide-react'
import type { SettingsView } from '@shared/ipc'
import type { MessageKey } from '@shared/i18n'
import { installSettingsBridge, useSessionStore } from './state/sessionStore'
import { useT } from './i18n/useT'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { AppToast } from './components/AppToast'
import { Button, Modal } from './components/ui'
import { ApiSettings } from './components/settings/ApiSettings'
import { WorkspaceSettings } from './components/settings/WorkspaceSettings'
import { AppearanceSettings } from './components/settings/AppearanceSettings'
import { NotificationsSettings } from './components/settings/NotificationsSettings'
import { CliSettings } from './components/settings/CliSettings'
import { AgentsSettings } from './components/settings/AgentsSettings'
import { FileAssociationsSettings } from './components/settings/FileAssociationsSettings'
import { AboutSettings } from './components/settings/AboutSettings'
import { getShortcuts } from './shortcuts'

const CATEGORY_KEYS: { id: SettingsView; labelKey: MessageKey; icon: React.JSX.Element }[] = [
  { id: 'api', labelKey: 'settings.nav.api', icon: <KeyRound size={13} /> },
  { id: 'workspace', labelKey: 'settings.nav.workspace', icon: <Folder size={13} /> },
  { id: 'appearance', labelKey: 'settings.nav.appearance', icon: <Palette size={13} /> },
  { id: 'notifications', labelKey: 'settings.nav.notifications', icon: <Bell size={13} /> },
  { id: 'agents', labelKey: 'settings.nav.agents', icon: <Bot size={13} /> },
  { id: 'cli', labelKey: 'settings.nav.cli', icon: <Terminal size={13} /> },
  {
    id: 'file-associations',
    labelKey: 'settings.nav.fileAssociations',
    icon: <FileCheck2 size={13} />
  },
  { id: 'about', labelKey: 'settings.nav.about', icon: <Info size={13} /> }
]

function initialCategory(): SettingsView {
  const requested = new URLSearchParams(window.location.search).get('category')
  return CATEGORY_KEYS.some((c) => c.id === requested) ? (requested as SettingsView) : 'api'
}

/**
 * Settings, in a window of its own rather than a sheet over the transcript.
 *
 * It runs a second copy of the session store, so it reads and writes through
 * the same IPC surface as the main window and the two stay in step via
 * `installSettingsBridge`. Fields save on change; close via the window chrome
 * or Escape (no Done footer).
 */
export default function SettingsWindow(): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const category = useSessionStore((s) => s.settingsCategory)

  useEffect(() => {
    useSessionStore.setState({ settingsCategory: initialCategory() })
    // Light: settings only — never load the active chat transcript into this window.
    void bootstrap(undefined, { light: true })
  }, [bootstrap])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offView = window.vav.onSettingsView((view) =>
      useSessionStore.setState({ settingsCategory: view })
    )
    const offMenu = installDefaultContextMenu()
    return () => {
      offSettings()
      offView()
      offMenu()
    }
  }, [])

  useAppearance()

  const close = useCallback((): void => {
    void window.vav.window.closeSettings()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!ready) return <div className="settings-window" />

  const title = t(CATEGORY_KEYS.find((c) => c.id === category)?.labelKey ?? 'settings.nav.api')

  return (
    <div className="settings-window">
      <nav className="settings-nav">
        {CATEGORY_KEYS.map((item) => (
          <div
            key={item.id}
            className={`conv-row${item.id === category ? ' selected' : ''}`}
            onClick={() => useSessionStore.setState({ settingsCategory: item.id })}
          >
            <span className="conv-icon">{item.icon}</span>
            <span className="conv-title">{t(item.labelKey)}</span>
          </div>
        ))}
      </nav>

      <div className="settings-main">
        <header className="settings-head">{title}</header>
        <div className="settings-body">
          {category === 'api' && <ApiSettings />}
          {category === 'workspace' && <WorkspaceSettings />}
          {category === 'appearance' && <AppearanceSettings />}
          {category === 'notifications' && <NotificationsSettings />}
          {category === 'agents' && <AgentsSettings />}
          {category === 'cli' && <CliSettings />}
          {category === 'file-associations' && <FileAssociationsSettings />}
          {category === 'about' && <AboutSettings />}
        </div>
      </div>

      <SettingsOverlays />
      <AppToast />
    </div>
  )
}

/** Shortcut list still uses an in-window Modal; confirms go through native dialogs. */
function SettingsOverlays(): React.JSX.Element | null {
  const t = useT()
  const shortcutsOpen = useSessionStore((s) => s.shortcutsOpen)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)
  const sendKey = useSessionStore((s) => s.settings.sendKey)

  if (!shortcutsOpen) return null

  const shortcuts = getShortcuts(t, { sendKey })

  return (
    <Modal
      title={t('about.shortcuts')}
      onDismiss={() => setShortcutsOpen(false)}
      actions={(dismiss) => (
        <Button label={t('common.ok')} variant="primary" onClick={dismiss} />
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shortcuts.map(([shortcutKeys, description]) => (
          <div key={shortcutKeys} style={{ display: 'flex', gap: 12 }}>
            <kbd style={{ minWidth: 130 }}>{shortcutKeys}</kbd>
            <span>{description}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
