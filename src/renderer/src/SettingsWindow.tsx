import { useEffect, useState } from 'react'
import { Folder, Info, KeyRound, Palette } from 'lucide-react'
import type { SettingsView } from '@shared/ipc'
import { installSettingsBridge, useSessionStore } from './state/sessionStore'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { Button, Modal } from './components/ui'
import { ApiSettings } from './components/settings/ApiSettings'
import { WorkspaceSettings } from './components/settings/WorkspaceSettings'
import { AppearanceSettings } from './components/settings/AppearanceSettings'
import { AboutSettings } from './components/settings/AboutSettings'
import { SHORTCUTS } from './shortcuts'

const CATEGORIES: { id: SettingsView; label: string; icon: React.JSX.Element }[] = [
  { id: 'api', label: 'API 与模型', icon: <KeyRound size={13} /> },
  { id: 'workspace', label: '工作区', icon: <Folder size={13} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={13} /> },
  { id: 'about', label: '关于', icon: <Info size={13} /> }
]

function initialCategory(): SettingsView {
  const requested = new URLSearchParams(window.location.search).get('category')
  return CATEGORIES.some((c) => c.id === requested) ? (requested as SettingsView) : 'api'
}

/**
 * Settings, in a window of its own rather than a sheet over the transcript.
 *
 * It runs a second copy of the session store, so it reads and writes through
 * the same IPC surface as the main window and the two stay in step via
 * `installSettingsBridge`. Non-key fields save on change; the API key is the
 * one field that waits for 完成.
 */
export default function SettingsWindow(): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const category = useSessionStore((s) => s.settingsCategory)

  const [footer, setFooter] = useState('')
  const [commit, setCommit] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    useSessionStore.setState({ settingsCategory: initialCategory() })
    void bootstrap()
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

  const close = (): void => void window.vav.window.closeSettings()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) return <div className="settings-window" />

  const title = CATEGORIES.find((c) => c.id === category)?.label ?? ''

  return (
    <div className="settings-window">
      <nav className="settings-nav">
        {CATEGORIES.map((item) => (
          <div
            key={item.id}
            className={`conv-row${item.id === category ? ' selected' : ''}`}
            onClick={() => useSessionStore.setState({ settingsCategory: item.id })}
          >
            <span className="conv-icon">{item.icon}</span>
            <span className="conv-title">{item.label}</span>
          </div>
        ))}
      </nav>

      <div className="settings-main">
        <header className="settings-head">{title}</header>
        <div className="settings-body">
          {category === 'api' && (
            <ApiSettings onFooterMessage={setFooter} registerCommit={(fn) => setCommit(() => fn)} />
          )}
          {category === 'workspace' && <WorkspaceSettings />}
          {category === 'appearance' && <AppearanceSettings />}
          {category === 'about' && <AboutSettings />}
        </div>
        <footer className="settings-foot">
          <span className="muted">{footer}</span>
          <span className="spacer" />
          <Button
            label="完成"
            variant="primary"
            onClick={async () => {
              await commit?.()
              close()
            }}
          />
        </footer>
      </div>

      <SettingsOverlays />
    </div>
  )
}

/** About can raise a confirm and the shortcut list, so both live here too. */
function SettingsOverlays(): React.JSX.Element {
  const dialog = useSessionStore((s) => s.dialog)
  const closeDialog = useSessionStore((s) => s.closeDialog)
  const shortcutsOpen = useSessionStore((s) => s.shortcutsOpen)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)

  return (
    <>
      {dialog && (
        <Modal
          title={dialog.title}
          onDismiss={closeDialog}
          actions={
            <>
              {dialog.onConfirm && <Button label="取消" onClick={closeDialog} />}
              <Button
                label={dialog.confirmLabel}
                variant={dialog.destructive ? 'danger' : 'primary'}
                onClick={() => {
                  closeDialog()
                  dialog.onConfirm?.()
                }}
              />
            </>
          }
        >
          {dialog.body}
        </Modal>
      )}

      {shortcutsOpen && (
        <Modal
          title="快捷键"
          onDismiss={() => setShortcutsOpen(false)}
          actions={<Button label="好" variant="primary" onClick={() => setShortcutsOpen(false)} />}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SHORTCUTS.map(([keys, description]) => (
              <div key={keys} style={{ display: 'flex', gap: 12 }}>
                <kbd style={{ minWidth: 130 }}>{keys}</kbd>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
