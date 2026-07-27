import { useEffect, useState } from 'react'
import { PanelLeft, Plus, Search, Settings } from 'lucide-react'
import { useSessionStore } from './state/sessionStore'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge, useWorkspaceStore } from './state/workspaceStore'
import { Sidebar } from './components/Sidebar'
import { Transcript } from './components/Transcript'
import { Composer } from './components/Composer'
import { ToolsPanel } from './components/ToolsPanel'
import { SearchStrip } from './components/SearchStrip'
import { PlanOverlay } from './components/PlanOverlay'
import { ErrorBanner } from './components/ErrorBanner'
import { Button, Modal } from './components/ui'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { applyTerminalAppearance } from './lib/terminalRegistry'
import { keys } from './lib/platform'
import { getShortcuts } from './shortcuts'
import { useT } from './i18n/useT'

export default function App(): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offSettings = installSettingsBridge()
    const offWindow = installWindowBridge()
    const offMenu = installDefaultContextMenu()
    const offCli = window.vav.onCliOpen((event) => {
      const store = useSessionStore.getState()
      void store.selectConversation(event.conversationId).then(() => {
        if (event.attachments?.length) {
          store.setAttachments(event.conversationId, event.attachments)
        }
        store.focusComposer()
      })
      if (event.toast) store.setErrorBanner(event.toast)
    })
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offWindow()
      offMenu()
      offCli()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()
  useResponsiveSidebar()

  if (!ready) return <div className="app-shell" />

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="body-split">
        <SidebarSlot />
        <Detail />
      </div>
      <Overlays />
    </div>
  )
}

function Titlebar(): React.JSX.Element {
  const t = useT()
  const createConversation = useSessionStore((s) => s.createConversation)
  const openSearch = useSessionStore((s) => s.openSearch)
  const openSettings = useSessionStore((s) => s.openSettings)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)

  return (
    <header className="titlebar">
      {/* Starting a session belongs with the list it lands in, not with the
          window-level controls at the far end. */}
      <Button
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
      <Button
        icon={<Plus size={14} />}
        label={t('app.newSession')}
        size="sm"
        title={t('app.newSessionTitle', { shortcut: keys('⌘N') })}
        onClick={() => void createConversation()}
      />
      <span className="spacer" />
      <Button
        icon={<Search size={14} />}
        size="sm"
        title={`${t('common.search')} ${keys('⌘F')}`}
        onClick={openSearch}
      />
      <Button
        icon={<Settings size={14} />}
        size="sm"
        title={t('app.settingsTitle', { shortcut: keys('⌘,') })}
        onClick={() => openSettings()}
      />
    </header>
  )
}

function SidebarSlot(): React.JSX.Element | null {
  const visible = useSessionStore((s) => s.sidebarVisible)
  return visible ? <Sidebar /> : null
}

function Detail(): React.JSX.Element {
  const t = useT()
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)

  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)

  return (
    <main className="detail">
      {errorBanner && (
        <ErrorBanner
          message={errorBanner}
          actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
          onAction={isKeyProblem ? () => openSettings('api') : undefined}
          onDismiss={() => setErrorBanner(null)}
        />
      )}
      <div className="detail-stream" data-search={searchOpen}>
        {searchOpen && <SearchStrip />}
        <PlanOverlay />
        <Transcript />
      </div>
      {/* Tools and prompt share one surface: what the agent can touch and what
          you tell it to do are one control area, not two. */}
      <div className="dock">
        <ToolsPanel />
        <Composer />
      </div>
    </main>
  )
}

function Overlays(): React.JSX.Element {
  const t = useT()
  const shortcutsOpen = useSessionStore((s) => s.shortcutsOpen)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)

  if (!shortcutsOpen) return <></>

  const shortcuts = getShortcuts(t)

  return (
    <Modal
      title={t('about.shortcuts')}
      onDismiss={() => setShortcutsOpen(false)}
      actions={
        <Button label={t('common.ok')} variant="primary" onClick={() => setShortcutsOpen(false)} />
      }
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

/**
 * xterm sits outside React, so it needs the font pushed to it.
 *
 * This lives here rather than in the appearance form: the terminals belong to
 * this window, and the change may well have come from the settings window.
 */
function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)

  useEffect(() => {
    applyTerminalAppearance(codeFont, Math.max(9, fontSize - 3))
  }, [codeFont, fontSize])
}

/** Native menu accelerators arrive here, even when xterm has focus. */
function useMenuCommands(): void {
  useEffect(() => {
    return window.vav.onMenuCommand((command) => {
      const store = useSessionStore.getState()
      switch (command) {
        case 'new-conversation':
          void store.createConversation()
          break
        case 'focus-composer':
          store.focusComposer()
          break
        case 'find':
          store.openSearch()
          break
        case 'find-next':
          store.stepSearch(1)
          break
        case 'find-previous':
          store.stepSearch(-1)
          break
        case 'open-settings':
          store.openSettings()
          break
        case 'toggle-sidebar':
          store.toggleSidebar()
          break
        case 'toggle-tools-panel':
          store.toggleToolsPanel()
          break
        case 'toggle-panel-segment':
          store.togglePanelSegment()
          break
        case 'new-terminal':
          store.setPanelSegment('terminal')
          void useWorkspaceStore.getState().newBash(store.activeId, 80, 24)
          break
        case 'switch-workdir':
          store.openWorkspaceSwitcher()
          break
        case 'send': {
          const draft = store.drafts[store.activeId] ?? ''
          const attachments = store.attachments[store.activeId] ?? []
          void store.send(draft.trim(), attachments)
          break
        }
        case 'focus-tools-1':
        case 'focus-tools-2':
        case 'focus-tools-3':
        case 'focus-tools-4':
        case 'focus-tools-5':
        case 'focus-tools-6':
        case 'focus-tools-7':
        case 'focus-tools-8':
        case 'focus-tools-9':
          store.focusToolsSlot(Number(command.slice('focus-tools-'.length)))
          break
      }
    })
  }, [])
}

/** Auto-collapses the sidebar on a narrow window; the user can always re-show it. */
function useResponsiveSidebar(): void {
  const [autoCollapsed, setAutoCollapsed] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      const narrow = window.innerWidth <= 520
      const store = useSessionStore.getState()
      if (narrow && store.sidebarVisible && !autoCollapsed) {
        setAutoCollapsed(true)
        store.toggleSidebar()
      } else if (!narrow && autoCollapsed) {
        setAutoCollapsed(false)
        if (!store.sidebarVisible) store.toggleSidebar()
      }
    }
    // Debounce past the live-resize storm — toggling the sidebar mid-drag
    // forces a full layout on every crossing of the 520px threshold.
    const onResize = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 120)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [autoCollapsed])
}
