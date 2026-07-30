import { useEffect, useState } from 'react'
import { Download, PanelLeft, Plus, RotateCw, Search, Settings } from 'lucide-react'
import { useSessionStore } from './state/sessionStore'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge, useWorkspaceStore } from './state/workspaceStore'
import { Sidebar } from './components/Sidebar'
import { ChangeReviewPanel } from './components/ChangeReviewPanel'
import { SessionDetail, useTerminalAppearance } from './components/SessionDetail'
import { WorkspaceView } from './components/WorkspaceView'
import { Button, Modal } from './components/ui'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
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
    const offUpdates = installUpdateBridge()
    const offMenu = installDefaultContextMenu()
    const offCli = window.vav.onCliOpen((event) => {
      const store = useSessionStore.getState()
      // Reveal in List / CLI open: leave workspace view so the sidebar row is visible.
      if (store.activeGroupId) store.selectWorkspaceGroup(null)
      if (!store.sidebarVisible) store.toggleSidebar()
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
      offUpdates()
      offMenu()
      offCli()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()
  useResponsiveSidebar()

  const changeReviewId = useSessionStore((s) => s.changeReviewId)

  if (!ready) return <div className="app-shell" />

  if (changeReviewId) {
    return (
      <div className="app-shell">
        <ChangeReviewPanel />
        <ToastHost />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="body-split">
        <SidebarSlot />
        <DetailSlot />
      </div>
      <Overlays />
      <ToastHost />
    </div>
  )
}

function DetailSlot(): React.JSX.Element {
  const activeGroupId = useSessionStore((s) => s.activeGroupId)
  if (activeGroupId) return <WorkspaceView workdir={activeGroupId} />
  return <SessionDetail />
}

function Titlebar(): React.JSX.Element {
  const t = useT()
  const createConversation = useSessionStore((s) => s.createConversation)
  const openSearch = useSessionStore((s) => s.openSearch)
  const openSettings = useSessionStore((s) => s.openSettings)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const updateState = useSessionStore((s) => s.updateState)
  const downloadUpdate = useSessionStore((s) => s.downloadUpdate)
  const installUpdate = useSessionStore((s) => s.installUpdate)

  const updateButton =
    updateState.phase === 'available' ? (
      <Button
        icon={<Download size={14} />}
        label={t('update.availableButton', { version: updateState.latestVersion ?? '' })}
        variant="primary"
        size="sm"
        onClick={() => void downloadUpdate()}
      />
    ) : updateState.phase === 'downloading' ? (
      <Button
        icon={<Download size={14} />}
        label={t('update.downloading', { progress: updateState.progress })}
        variant="primary"
        size="sm"
        disabled
      />
    ) : updateState.phase === 'ready' ? (
      <Button
        icon={<RotateCw size={14} />}
        label={t('update.restartInstall')}
        variant="primary"
        size="sm"
        onClick={() => void installUpdate()}
      />
    ) : null

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
      {updateButton}
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

/** Below this width the sidebar docks off and opens as a floating overlay. */
const SIDEBAR_FLOAT_MAX = 720

function useSidebarFloatMode(): boolean {
  const [floating, setFloating] = useState(() => window.innerWidth <= SIDEBAR_FLOAT_MAX)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      setFloating(window.innerWidth <= SIDEBAR_FLOAT_MAX)
    }
    const onResize = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 80)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return floating
}

function SidebarSlot(): React.JSX.Element | null {
  const t = useT()
  const visible = useSessionStore((s) => s.sidebarVisible)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const floating = useSidebarFloatMode()

  useEffect(() => {
    if (!visible || !floating) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      // Let text fields consume Escape first (clear search / cancel rename).
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      event.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, floating, toggleSidebar])

  if (!visible) return null

  if (!floating) return <Sidebar />

  const close = (): void => {
    if (useSessionStore.getState().sidebarVisible) toggleSidebar()
  }

  return (
    <div className="sidebar-float-host" role="presentation">
      <div
        className="sidebar-float-scrim"
        onMouseDown={(event) => {
          if (event.button === 0) close()
        }}
      />
      <div
        className="sidebar-float-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcut.toggleSidebar')}
      >
        <Sidebar floating onNavigate={close} />
      </div>
    </div>
  )
}

function ToastHost(): React.JSX.Element | null {
  const toast = useSessionStore((s) => s.toast)
  const showToast = useSessionStore((s) => s.showToast)
  if (!toast) return null
  return (
    <div className={`app-toast kind-${toast.kind}`} role="status">
      <div className="app-toast-title">{toast.title}</div>
      {toast.description && <div className="app-toast-body">{toast.description}</div>}
      <button type="button" className="app-toast-dismiss" onClick={() => showToast(null)}>
        ×
      </button>
    </div>
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
        case 'focus-bash':
          store.focusBashTerminal()
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

/**
 * On a narrow window the sidebar becomes a floating overlay (see SidebarSlot).
 * Auto-hide when entering that band so the detail column keeps full width;
 * restore when the window is wide enough again. The user can always re-open
 * it (as a float while narrow, docked while wide).
 */
function useResponsiveSidebar(): void {
  const [autoCollapsed, setAutoCollapsed] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      const narrow = window.innerWidth <= SIDEBAR_FLOAT_MAX
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
    // forces a full layout on every crossing of the float threshold.
    const onResize = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 120)
    }
    apply()
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [autoCollapsed])
}
