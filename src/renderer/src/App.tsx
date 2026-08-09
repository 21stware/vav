import { useEffect, useState, type ReactNode } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installCompactionsBridge,
  installDetachedBridge,
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge } from './state/workspaceStore'
import { Sidebar } from './components/Sidebar'
import { SessionDetail } from './components/SessionDetail'
import { useTerminalAppearance } from './lib/useTerminalAppearance'
import { WorkspaceView } from './components/WorkspaceView'
import { FileSessionView } from './components/FileSessionView'
import { AppToast } from './components/AppToast'
import { UpdateCorner } from './components/UpdateCorner'
import { ShellLeadingControls } from './components/ShellLeadingControls'
import { Button, EmptyState, Modal } from './components/ui'
import { KeychainOnboarding } from './components/KeychainOnboarding'
import { useAppearance } from './lib/appearance'
import { useMenuCommands } from './lib/menuCommands'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { SIDEBAR_FLOAT_MAX, useSidebarFloatMode } from './lib/sidebarLayout'
import { getShortcuts } from './shortcuts'
import { isTemporaryWorkspace } from './lib/format'
import { useT } from './i18n/useT'

type LaunchPhase = 'checking' | 'keychain' | 'booting' | 'ready' | 'no-preload'

/** First paint: stay blank until secrets.status() — don't flash the welcome tour. */
function initialLaunchPhase(): LaunchPhase {
  try {
    if (!window.vav) return 'no-preload'
  } catch {
    // preload may be absent in non-electron tests
  }
  return 'checking'
}

export default function App(): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const [phase, setPhase] = useState<LaunchPhase>(initialLaunchPhase)
  /** Returning mac users who fail silent unlock only see the authorize step. */
  const [keychainAuthorizeOnly, setKeychainAuthorizeOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!window.vav) {
        setPhase('no-preload')
        return
      }
      try {
        // status() is pure (no safeStorage) — only reports the gate flag.
        const status = await window.vav.secrets.status()
        if (cancelled) return
        if (status.needsUnlock) {
          // Already finished the tour once: unlock quietly (Keychain may still
          // sheet if the OS asks). Don't replay welcome/privacy every launch.
          if (status.onboardingComplete) {
            const result = await window.vav.secrets.unlock()
            if (cancelled) return
            if (result.ok) {
              setPhase('booting')
              await bootstrap()
              if (!cancelled) setPhase('ready')
              return
            }
            setKeychainAuthorizeOnly(true)
          } else {
            setKeychainAuthorizeOnly(false)
          }
          setPhase('keychain')
          return
        }
        setPhase('booting')
        await bootstrap()
        if (!cancelled) setPhase('ready')
      } catch {
        // If status IPC fails, still try to boot (dev / older preload).
        if (cancelled) return
        if (!window.vav) {
          setPhase('no-preload')
          return
        }
        setPhase('booting')
        await bootstrap()
        if (!cancelled) setPhase('ready')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrap])

  useEffect(() => {
    if (!window.vav) return
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offSettings = installSettingsBridge()
    const offCompactions = installCompactionsBridge()
    const offWindow = installWindowBridge()
    const offDetached = installDetachedBridge()
    const offUpdates = installUpdateBridge()
    const offMenu = installDefaultContextMenu()
    const offCli = window.vav.onCliOpen((event) => {
      const store = useSessionStore.getState()
      // Reveal in List / CLI open: leave workspace view so the sidebar row is visible.
      if (store.activeGroupId) store.selectWorkspaceGroup(null)
      if (!store.sidebarVisible) store.toggleSidebar()
      void store.selectConversation(event.conversationId).then(() => {
        const next = useSessionStore.getState()
        // File-bound sessions live under File sessions — jump the list there.
        const meta = next.conversations.find((c) => c.id === event.conversationId)
        if (meta?.fileId) {
          next.setSidebarListMode('fileSessions')
        } else if (meta?.archived) {
          next.setSidebarListMode('archive')
        } else {
          next.setSidebarListMode('main')
        }
        if (event.attachments?.length) {
          next.setAttachments(event.conversationId, event.attachments)
        }
        next.focusComposer()
      })
      if (event.toast) store.setErrorBanner(event.toast)
    })
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offCompactions()
      offWindow()
      offDetached()
      offUpdates()
      offMenu()
      offCli()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()
  useResponsiveSidebar()

  const floating = useSidebarFloatMode()
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  // Docked sidebar owns traffic-light chrome. Collapsed: session parks toggle
  // on the agent row; workspace parks it on the preview file header.
  const panelFlushTop = sidebarVisible && !floating

  if (phase === 'no-preload') {
    return (
      <div className="app-shell" style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
        <EmptyState
          title="Open vav in Electron"
          description="The preload bridge is missing — this usually means a browser tab on :5173, or Electron was killed. Run npm run dev and use the app window."
        />
      </div>
    )
  }

  if (phase === 'keychain') {
    return (
      <KeychainOnboarding
        authorizeOnly={keychainAuthorizeOnly}
        onUnlocked={async () => {
          setPhase('booting')
          await bootstrap()
          setPhase('ready')
        }}
      />
    )
  }

  if (phase === 'checking' || phase === 'booting' || !ready) {
    return <div className="app-shell" />
  }

  // Change review is inline in the transcript (not a full-screen takeover).
  return (
    <div className={`app-shell${panelFlushTop ? ' panel-flush-top' : ' panel-shell-chrome'}`}>
      <div className="body-split">
        <SidebarSlot
          floating={floating}
          chrome={panelFlushTop ? <Titlebar variant="sidebar" /> : null}
        />
        <DetailSlot />
      </div>
      <Overlays />
      {/* When the sidebar is open it hosts the chip; otherwise pin bottom-left. */}
      {!sidebarVisible ? <UpdateCorner /> : null}
      <AppToast />
    </div>
  )
}

function DetailSlot(): React.JSX.Element {
  const activeGroupId = useSessionStore((s) => s.activeGroupId)
  const tmp = useSessionStore((s) => s.tmp)
  const activeConversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === s.activeId)
  )

  // Real project path → Workspace View. Default / temporary shells are not.
  if (
    activeGroupId &&
    !activeGroupId.startsWith('__') &&
    !isTemporaryWorkspace(activeGroupId, tmp)
  ) {
    return <WorkspaceView workdir={activeGroupId} />
  }
  // File-bound sessions: file canvas + agent (list lives in sidebar File sessions).
  if (activeConversation?.fileId) {
    return (
      <FileSessionView
        conversationId={activeConversation.id}
        fileId={activeConversation.fileId}
      />
    )
  }
  // No session yet — empty chat surface; first send / file add mints the session.
  return <SessionDetail />
}

function Titlebar({
  variant = 'window'
}: {
  /** `sidebar` — chrome row inside the docked list column (panel flush to top). */
  variant?: 'window' | 'sidebar'
}): React.JSX.Element {
  return (
    <header className={`titlebar${variant === 'sidebar' ? ' sidebar-chrome' : ''}`}>
      <ShellLeadingControls />
      <span className="spacer" />
    </header>
  )
}

const SIDEBAR_FLOAT_LEAVE_MS = 220 // --dur-sheet

function SidebarSlot({
  floating,
  chrome
}: {
  floating: boolean
  /** Docked flush layout: toggle / new-session row above the list. */
  chrome?: ReactNode
}): React.JSX.Element | null {
  const t = useT()
  const visible = useSessionStore((s) => s.sidebarVisible)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const [floatMounted, setFloatMounted] = useState(false)
  const [floatLeaving, setFloatLeaving] = useState(false)

  useEffect(() => {
    if (visible && floating) {
      setFloatMounted(true)
      setFloatLeaving(false)
      return
    }
    if (!floatMounted) return
    // Docked mode: drop float host immediately (no exit of a panel that is not floating).
    if (!floating) {
      setFloatMounted(false)
      setFloatLeaving(false)
      return
    }
    setFloatLeaving(true)
    const id = window.setTimeout(() => {
      setFloatMounted(false)
      setFloatLeaving(false)
    }, SIDEBAR_FLOAT_LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [visible, floating, floatMounted])

  useEffect(() => {
    if (!visible || !floating || floatLeaving) return
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
  }, [visible, floating, floatLeaving, toggleSidebar])

  if (!floating) {
    if (!visible) return null
    if (chrome) {
      return (
        <div className="sidebar-column">
          {chrome}
          <Sidebar />
        </div>
      )
    }
    return <Sidebar />
  }

  if (!floatMounted) return null

  const close = (): void => {
    if (useSessionStore.getState().sidebarVisible) toggleSidebar()
  }

  return (
    <div
      className="sidebar-float-host"
      role="presentation"
      data-leaving={floatLeaving || undefined}
    >
      <div
        className="sidebar-float-scrim"
        onMouseDown={(event) => {
          if (event.button === 0 && !floatLeaving) close()
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

function Overlays(): React.JSX.Element {
  const t = useT()
  const shortcutsOpen = useSessionStore((s) => s.shortcutsOpen)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)
  const sendKey = useSessionStore((s) => s.settings.sendKey)

  if (!shortcutsOpen) return <></>

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
