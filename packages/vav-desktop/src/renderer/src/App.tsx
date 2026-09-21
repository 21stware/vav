import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installAgentModelCatalogBridge,
  installCompactionsBridge,
  installDetachedBridge,
  installHostsBridge,
  installRemoteControlBridge,
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge,
  installActivityBridge
} from './state/sessionBridges'
import { installFsWatchBridge, installPtyBridge } from './state/workspaceStore'
import { Sidebar } from './components/Sidebar'
import { SessionDetail } from './components/SessionDetail'
import { PipView } from './components/PipView'
import { useTerminalAppearance } from './lib/useTerminalAppearance'
import { ApplicationsPanel } from './components/ApplicationsPanel'
import { AppToast } from './components/AppToast'
import { RemoteFolderPicker } from './components/RemoteFolderPicker'
import { UpdateCorner } from './components/UpdateCorner'
import { ShellLeadingControls } from './components/ShellLeadingControls'
import { EmptyState } from './components/ui'
import { KeychainOnboarding } from './components/KeychainOnboarding'
import { useAppearance } from './lib/appearance'
import { useMenuCommands } from './lib/menuCommands'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { installInstallRunBridge } from './state/installRunStore'
import { useSidebarFloatMode } from './lib/sidebarLayout'
import { startCapturedPointerDrag } from './lib/capturedPointerDrag'
import { useWindowMinSize } from './lib/useWindowMinSize'
import {
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
  loadSidebarWidth,
  persistSidebarWidth
} from './lib/sidebarWidth'
import {
  APPLICATIONS_WIDTH_DEFAULT,
  clampApplicationsWidth,
  loadApplicationsWidth,
  persistApplicationsWidth
} from './lib/applicationsWidth'
import { useT } from './i18n/useT'
import { useAttentionSeen } from './lib/useAttentionSeen'
import { installSwarmHistoryBridge } from './lib/swarmHistoryBridge'
import { installE2eBridge } from './lib/e2eBridge'
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
    const offHosts = installHostsBridge()
    const offRemoteControl = installRemoteControlBridge()
    const offCompactions = installCompactionsBridge()
    const offWindow = installWindowBridge()
    const offActivity = installActivityBridge()
    const offDetached = installDetachedBridge()
    const offUpdates = installUpdateBridge()
    const offModels = installAgentModelCatalogBridge()
    const offMenu = installDefaultContextMenu()
    const offHistory = installSwarmHistoryBridge()
    const offCli = window.vav.onCliOpen((event) => {
      const store = useSessionStore.getState()
      // Reveal in List / CLI open: leave workspace view so the sidebar row is visible.
      if (store.activeGroupId) store.selectWorkspaceGroup(null)
      store.setSidebarVisible(true)
      void store.selectConversation(event.conversationId).then(async () => {
        const next = useSessionStore.getState()
        const meta = next.conversations.find((c) => c.id === event.conversationId)
        if (meta?.sessionKind === 'timer') {
          next.setSidebarListMode('timers')
        } else if (meta?.archived) {
          next.setSidebarListMode('archive')
        } else {
          next.setSidebarListMode('main')
        }
        if (event.attachments?.length) {
          next.addAttachments(event.conversationId, event.attachments)
        }
        // Tray / notify: enter CLI Agents + focus pane, or VAV composer.
        // selectConversation already hydrated PTYs; apply flips surface/mode.
        const { applySessionSurfaceFocus } = await import('./lib/sessionFocus')
        await applySessionSurfaceFocus(event)
      })
      if (event.toast) store.setErrorBanner(event.toast)
    })
    const offInstall = installInstallRunBridge()
    const offE2e = installE2eBridge()
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offHosts()
      offRemoteControl()
      offCompactions()
      offWindow()
      offActivity()
      offDetached()
      offUpdates()
      offModels()
      offMenu()
      offCli()
      offHistory()
      offInstall()
      offE2e()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()
  useWindowMinSize()
  const activeId = useSessionStore((s) => s.activeId)
  useAttentionSeen(activeId)

  const floating = useSidebarFloatMode()
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const pictureInPicture = useSessionStore((s) => s.pictureInPicture)
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

  if (pictureInPicture) {
    return (
      <>
        <PipView />
        <AppToast />
        <RemoteFolderPicker />
      </>
    )
  }

  // Change review is inline in the transcript (not a full-screen takeover).
  return (
    <div
      className={`app-shell${panelFlushTop ? ' panel-flush-top' : ' panel-shell-chrome'}`}
      data-testid="app-shell"
    >
      <div className="body-split" data-shell="list-agent-app">
        <SidebarSlot
          floating={floating}
          chrome={panelFlushTop ? <Titlebar variant="sidebar" /> : null}
        />
        <AgentSlot />
        <ApplicationsSlot />
      </div>
      {/* When the sidebar is open it hosts the chip; otherwise pin bottom-left. */}
      {!sidebarVisible ? <UpdateCorner /> : null}
      <AppToast />
      <RemoteFolderPicker />
    </div>
  )
}

function CategoryEmpty({
  title,
  description,
  children
}: {
  title: string
  description: string
  children?: ReactNode
}): React.JSX.Element {
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const floating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !floating)
  return (
    <main className="detail category-empty" data-testid="session-detail">
      <header
        className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
      >
        <div className="agent-mode-chrome-row">
          {showShellLeading ? (
            <div className="agent-mode-shell-leading">
              <ShellLeadingControls />
            </div>
          ) : null}
          <span className="spacer" />
        </div>
      </header>
      <EmptyState title={title} description={description}>
        {children}
      </EmptyState>
    </main>
  )
}

function AgentSlot(): React.JSX.Element {
  const t = useT()
  const visible = useSessionStore((s) => s.agentVisible)
  const listMode = useSessionStore((s) => s.sidebarListMode)
  const hasActive = useSessionStore((s) => s.conversations.some((c) => c.id === s.activeId))

  return (
    <div className="agent-column" data-testid="agent-column" hidden={!visible}>
      {!hasActive && listMode === 'archive' ? (
        <CategoryEmpty
          title={t('sidebar.archiveEmptyTitle')}
          description={t('sidebar.archiveEmptyDesc')}
        />
      ) : (
        <SessionDetail />
      )}
    </div>
  )
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

function ApplicationsSlot(): React.JSX.Element | null {
  const t = useT()
  const visible = useSessionStore((s) => s.applicationsVisible)
  const [applicationsWidth, setApplicationsWidth] = useState(loadApplicationsWidth)
  const columnRef = useRef<HTMLDivElement>(null)

  const startApplicationsResize = (event: ReactPointerEvent<HTMLElement>): void => {
    const startX = event.clientX
    const startWidth = applicationsWidth
    let latest = startWidth
    let raf = 0
    let pendingX = startX

    startCapturedPointerDrag(event, {
      cursor: 'col-resize',
      onMove: (e) => {
        pendingX = e.clientX
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          latest = clampApplicationsWidth(startWidth - (pendingX - startX))
          if (columnRef.current) columnRef.current.style.width = `${latest}px`
        })
      },
      onUp: () => {
        if (raf) cancelAnimationFrame(raf)
        setApplicationsWidth(latest)
        persistApplicationsWidth(latest)
        window.dispatchEvent(new Event('vav:resize-end'))
      }
    })
  }

  const resetApplicationsWidth = (): void => {
    setApplicationsWidth(APPLICATIONS_WIDTH_DEFAULT)
    persistApplicationsWidth(APPLICATIONS_WIDTH_DEFAULT)
    window.dispatchEvent(new Event('vav:resize-end'))
  }

  return (
    <div
      className="applications-column app-column"
      ref={columnRef}
      data-testid="app-column"
      data-applications-column=""
      style={{ width: applicationsWidth }}
      hidden={!visible}
    >
      <div
        className="applications-col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('applications.resize')}
        title={t('applications.resize')}
        onPointerDown={startApplicationsResize}
        onDoubleClick={resetApplicationsWidth}
      />
      <ApplicationsPanel />
    </div>
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
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const columnRef = useRef<HTMLDivElement>(null)

  /** Drag the docked column edge; clamp to [MIN, MAX], persist on release. */
  const startSidebarResize = (event: ReactPointerEvent<HTMLElement>): void => {
    const startX = event.clientX
    const startWidth = sidebarWidth
    let latest = startWidth
    let raf = 0
    let pendingX = startX

    startCapturedPointerDrag(event, {
      cursor: 'col-resize',
      onMove: (e) => {
        pendingX = e.clientX
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          latest = clampSidebarWidth(startWidth + (pendingX - startX))
          if (columnRef.current) columnRef.current.style.width = `${latest}px`
        })
      },
      onUp: () => {
        if (raf) cancelAnimationFrame(raf)
        setSidebarWidth(latest)
        persistSidebarWidth(latest)
        window.dispatchEvent(new Event('vav:resize-end'))
      }
    })
  }

  const resetSidebarWidth = (): void => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    persistSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    window.dispatchEvent(new Event('vav:resize-end'))
  }

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
    // Keep the column mounted. Unmounting rebuilt the glass hole and the
    // whole session list on every toggle.
    return (
      <div
        className="sidebar-column list-column"
        ref={columnRef}
        data-testid="list-column"
        style={{ width: sidebarWidth }}
        hidden={!visible}
      >
        {chrome}
        <Sidebar />
        <div
          className="sidebar-col-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('sidebar.resize')}
          title={t('sidebar.resize')}
          onPointerDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
        />
      </div>
    )
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
        id="closeDrawer"
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

