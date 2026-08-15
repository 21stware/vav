import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Folder,
  GitBranch,
  Terminal as TerminalIcon,
  Unplug
} from 'lucide-react'
import {
  useSessionStore,
  DEFAULT_SESSION_TOOLS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_SNAP_RATIO
} from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { basename } from '../lib/path'
import { isTemporaryWorkspace, truncatePathLabel, workdirLabel } from '../lib/format'
import { useGitRepoSyncEpoch } from '../lib/gitRepoSync'
import { FilesPanel } from './FilesPanel'
import { TerminalPanel } from './TerminalPanel'
import { disposeTerminal } from '../lib/terminalRegistry'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel, keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button, Chip } from './ui'
import { useInstallRunStore } from '../state/installRunStore'

/**
 * The tools tray in the bottom dock (below the composer).
 *
 * Files and Terminal are both mounted; only visibility switches, and collapsing
 * takes the body to zero height without destroying either pane
 * (main-chat.rpml annotation 5). Path / shell chips are accordion toggles
 * (annotation 6): on → off collapses; off → on expands that segment.
 *
 * Workspace change lives on a trailing control inside the path capsule so it
 * does not fight the accordion click. Recent directories open as a native menu.
 */
export function ToolsPanel({
  variant = 'main'
}: {
  variant?: 'main' | 'preview-edit'
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const collapsed = useSessionStore((s) => s.toolsCollapsed)
  const segment = useSessionStore((s) => s.panelSegment)
  const panelHeight = useSessionStore((s) => s.panelHeight)
  const tmp = useSessionStore((s) => s.tmp)
  const home = useSessionStore((s) => s.home)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const workspaceMenuNonce = useSessionStore((s) => s.workspaceMenuNonce)

  const toggleToolsPanel = useSessionStore((s) => s.toggleToolsPanel)
  const setToolsCollapsed = useSessionStore((s) => s.setToolsCollapsed)
  const setPanelSegment = useSessionStore((s) => s.setPanelSegment)
  const setPanelHeight = useSessionStore((s) => s.setPanelHeight)
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const showDialog = useSessionStore((s) => s.showDialog)

  // Narrow selectors — agent FS refresh mutates `dirs` constantly; subscribing
  // to the whole workspace slice re-rendered Workspace/VAV chips every tick.
  const workspaceRoot = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const workspaceTabs = useWorkspaceStore((s) => s.workspaces[activeId]?.tabs)
  const workspaceActiveTabId = useWorkspaceStore(
    (s) => s.workspaces[activeId]?.activeTabId ?? ''
  )
  const rootError = useWorkspaceStore((s) => {
    const root = s.workspaces[activeId]?.root
    return root ? s.workspaces[activeId]?.dirErrors[root] : undefined
  })
  const newBash = useWorkspaceStore((s) => s.newBash)
  const selectTab = useWorkspaceStore((s) => s.selectTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const tabStatus = useWorkspaceStore((s) => s.ptyStatus[activeId])

  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragState = useRef<{
    startY: number
    startHeight: number
    maxHeight: number
  } | null>(null)
  const pathChipRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Height before the last snap-to-70%. Restored on a second double-click. */
  const restoreHeightRef = useRef<{ id: string; height: number } | null>(null)
  const seenMenuNonce = useRef(0)
  /** Path chip glyph: git branch when the workdir is a repository. */
  const [workdirIsGit, setWorkdirIsGit] = useState(false)

  /**
   * Switching sessions restores that conversation's tray state. The tray must
   * already be open (or closed) when the new session paints — animating it is
   * reporting on a switch the user did not perform on the tray itself.
   * Toggling stays animated: only this commit is snapped.
   */
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.dataset.instant = 'true'
    // Land the restored height/segment in this style pass, before the frame
    // where the transition would otherwise start.
    void el.offsetHeight
    const frame = requestAnimationFrame(() => {
      delete el.dataset.instant
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId])

  const workdir = conversation?.workingDirectory ?? null
  const temporary = isTemporaryWorkspace(workdir, tmp)
  const gitRepoEpoch = useGitRepoSyncEpoch()

  useEffect(() => {
    let cancelled = false
    // Temp dirs can become repos after empty-session “enable version control”.
    if (!workdir || !window.vav?.git?.status) {
      setWorkdirIsGit(false)
      return
    }
    void window.vav.git
      .status(workdir)
      .then((snap) => {
        if (!cancelled) setWorkdirIsGit(!!snap.isRepo)
      })
      .catch(() => {
        if (!cancelled) setWorkdirIsGit(false)
      })
    return () => {
      cancelled = true
    }
  }, [workdir, gitRepoEpoch])

  // Session / workdir switches must dismiss the path-chip native menu (⌘⇧O /
  // context menu). AppKit does not always close it when only the renderer swaps.
  useEffect(() => {
    void window.vav.window.closePopupMenu?.()
  }, [activeId, workdir])
  const pathRevealed = useSessionStore((s) => s.workdirPathRevealed[s.activeId] === true)
  // File session: show "Enclosed dir" until user switches workdir (like Temporary → Workspace).
  const useEnclosedLabel =
    Boolean(conversation?.fileId) && !pathRevealed && !temporary
  // Parent folder gone (ENOENT) — chip becomes red "dir not exist"; Files is empty.
  // Still allow switch so the session can recover (pick a live workspace).
  const rootMissing =
    Boolean(workspaceRoot) &&
    (rootError === 'ENOENT' || /enoent|no such file|not found/i.test(rootError ?? ''))
  const label = rootMissing
    ? t('sidebar.dirNotExist')
    : useEnclosedLabel
      ? t('tools.enclosedDir')
      : truncatePathLabel(workdirLabel(workdir, tmp, home))
  const pathTitle = rootMissing
    ? t('sidebar.dirNotExist')
    : useEnclosedLabel
      ? t('tools.enclosedDirHint')
      : (workdir ?? t('sidebar.temporaryWorkspace'))
  // Enclosed dir (file session path bound): no switch while the path still works.
  // Missing root always allows switch so the conversation is not a dead end.
  const allowWorkdirSwitch = rootMissing || !useEnclosedLabel
  // Tools tray shows user bash only — never main-surface CLI agent hosts.
  const tabs = (workspaceTabs ?? []).filter(
    (t) => !t.agentId || t.agentId === 'vav' || t.isAgent
  )
  const activeTabId = workspaceActiveTabId
  const filesOn = !collapsed && segment === 'files' && !rootMissing
  const previewEdit = variant === 'preview-edit'
  const agentRunning = useSessionStore((s) => !!s.turns[activeId]?.isRunning)

  const locateWorkspace = useSessionStore((s) => s.locateWorkspace)

  // Missing enclosed dir: fold Files if open — nothing to browse.
  useEffect(() => {
    if (!rootMissing) return
    if (!collapsed && segment === 'files') setToolsCollapsed(true)
  }, [rootMissing, collapsed, segment, setToolsCollapsed])

  const snapHeight = useCallback((): number => {
    const column = panelRef.current?.closest('main')
    const raw = Math.round((column?.clientHeight ?? window.innerHeight) * PANEL_SNAP_RATIO)
    return Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, raw))
  }, [])

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      // Second click of a double-click must not start a drag.
      if (event.detail > 1) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      dragState.current = {
        startY: event.clientY,
        startHeight: panelHeight,
        maxHeight: snapHeight()
      }
      // Mark live tray drag: xterm still fits (tracks the pointer), but
      // terminalRegistry holds SIGWINCH until settle (ghost TUI frames).
      document.documentElement.dataset.resizing = 'true'
      setDragHeight(panelHeight)
    },
    [panelHeight, snapHeight]
  )

  const onResizerDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const snap = snapHeight()
      const current = dragHeight ?? panelHeight
      const atSnap = current >= snap - 12
      if (atSnap) {
        const saved =
          restoreHeightRef.current?.id === activeId
            ? restoreHeightRef.current.height
            : DEFAULT_SESSION_TOOLS.panelHeight
        restoreHeightRef.current = null
        setPanelHeight(Math.min(snap, Math.max(PANEL_MIN_HEIGHT, saved)))
      } else {
        if (activeId) restoreHeightRef.current = { id: activeId, height: current }
        setPanelHeight(snap)
      }
      window.dispatchEvent(new Event('vav:resize-end'))
    },
    [activeId, dragHeight, panelHeight, setPanelHeight, snapHeight]
  )

  useEffect(() => {
    if (dragHeight === null) return
    const onMove = (event: MouseEvent): void => {
      const state = dragState.current
      if (!state) return
      // Grip sits above the tray body: drag up → taller, drag down → shorter.
      const next = state.startHeight - (event.clientY - state.startY)
      setDragHeight(Math.min(state.maxHeight, Math.max(PANEL_MIN_HEIGHT, next)))
    }
    const onUp = (): void => {
      setDragHeight((height) => {
        if (height !== null) setPanelHeight(height)
        return null
      })
      dragState.current = null
      delete document.documentElement.dataset.resizing
      // One settled fit after the tray height is committed.
      window.dispatchEvent(new Event('vav:resize-end'))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Unmount mid-drag must not leave the global resize gate stuck.
      delete document.documentElement.dataset.resizing
    }
  }, [dragHeight, setPanelHeight])

  // Persisted / snapped height can outgrow a smaller window — clamp to 70%.
  useLayoutEffect(() => {
    const columnH = panelRef.current?.closest('main')?.clientHeight ?? 0
    if (columnH < PANEL_MIN_HEIGHT) return
    const max = snapHeight()
    if (panelHeight > max) setPanelHeight(max)
  }, [panelHeight, setPanelHeight, snapHeight])

  useEffect(() => {
    const onEnd = (): void => {
      const columnH = panelRef.current?.closest('main')?.clientHeight ?? 0
      if (columnH < PANEL_MIN_HEIGHT) return
      const max = snapHeight()
      if (useSessionStore.getState().panelHeight > max) setPanelHeight(max)
    }
    window.addEventListener('vav:resize-end', onEnd)
    return () => window.removeEventListener('vav:resize-end', onEnd)
  }, [setPanelHeight, snapHeight])

  const workspaceSwitchItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = []
    if (recentDirs.length === 0) {
      items.push({ label: t('tools.noRecentDirs'), disabled: true })
    } else {
      items.push({ label: t('tools.recentDirs'), disabled: true })
      for (const path of recentDirs) {
        const name = basename(path)
        const duplicate = recentDirs.filter((entry) => basename(entry) === name).length > 1
        items.push({
          label: duplicate ? path : name,
          onSelect: () => void setWorkingDirectory(activeId, path)
        })
      }
    }
    items.push({ label: '', divider: true })
    items.push({
      label: t('tools.pickOtherDir'),
      onSelect: () => void pickWorkingDirectory(activeId)
    })
    return items
  }, [recentDirs, activeId, setWorkingDirectory, pickWorkingDirectory, t])

  const openWorkspaceMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      void showMenu(workspaceSwitchItems(), anchor ? menuAnchor(anchor) : undefined)
    },
    [workspaceSwitchItems]
  )

  // ⌘⇧O and the app menu bump a nonce; open the same native menu as the capsule action.
  useEffect(() => {
    if (workspaceMenuNonce === 0 || workspaceMenuNonce === seenMenuNonce.current) return
    seenMenuNonce.current = workspaceMenuNonce
    if (!allowWorkdirSwitch) return
    openWorkspaceMenu(pathChipRef.current)
  }, [workspaceMenuNonce, openWorkspaceMenu, allowWorkdirSwitch])

  const createConversationInCurrentWorkspace = useSessionStore(
    (s) => s.createConversationInCurrentWorkspace
  )

  const pathContextItems = (): MenuItem[] => {
    // Missing root: only switch / pick / copy — nothing to browse or reveal.
    if (rootMissing) {
      return [
        ...workspaceSwitchItems(),
        { label: '', divider: true },
        {
          label: t('tools.copyPath'),
          disabled: !workdir,
          onSelect: () => void window.vav.conversations.copyToClipboard(workdir ?? '')
        }
      ]
    }
    // Enclosed dir: path is bound to the open file (no switch).
    if (useEnclosedLabel) {
      return [
        {
          label: t('tools.copyPath'),
          disabled: !workdir,
          onSelect: () => void window.vav.conversations.copyToClipboard(workdir ?? '')
        }
      ]
    }
    return [
      ...workspaceSwitchItems(),
      { label: '', divider: true },
      {
        label: t('files.newSessionHere'),
        onSelect: () => void createConversationInCurrentWorkspace()
      },
      ...(temporary
        ? [
            {
              label: t('tools.locateWorkspace'),
              onSelect: () => void locateWorkspace(activeId)
            } satisfies MenuItem
          ]
        : []),
      {
        label: t('tools.copyPath'),
        disabled: !workdir,
        onSelect: () => void window.vav.conversations.copyToClipboard(workdir ?? '')
      },
      {
        label: t('tools.revealInFm', { fileManager: fileManagerLabel() }),
        disabled: !workdir,
        onSelect: () => void window.vav.conversations.revealInFinder(workdir ?? '')
      }
    ]
  }

  const closeShellTab = (tabId: string, title: string, _isAgent: boolean): void => {
    const dispose = (): void => {
      disposeTerminal(activeId, tabId)
      closeTab(activeId, tabId)
    }
    void (async () => {
      // Idle tabs close silently; only a running command needs a confirm.
      const busy = await window.vav.pty.isBusy(tabId)
      if (!busy) {
        dispose()
        return
      }
      showDialog({
        title: t('tools.closeRunning'),
        body: t('tools.closeRunningBody', { title }),
        confirmLabel: t('tools.closeConfirm'),
        destructive: true,
        onConfirm: dispose
      })
    })()
  }

  /** Well paint size — grid 0fr/1fr owns open/close; this stays at the open px. */
  const openHeight = dragHeight ?? panelHeight

  const createBash = (): void => {
    void (async () => {
      let id = useSessionStore.getState().activeId
      if (!id) {
        await useSessionStore.getState().createConversation({ openIn: 'here' })
        id = useSessionStore.getState().activeId
      }
      if (!id) return
      setPanelSegment('terminal')
      void newBash(id, 80, 24)
    })()
  }

  /**
   * Auto-fold only when the *last bash tab just closed* (had tabs → none).
   *
   * Do NOT collapse on first paint / remount when tabs are already empty —
   * that fought ⌘⇧E / ⌘⇧T / restored session layout: expand ran, then this
   * effect treated `wasToolsEmpty === null` as "became empty" and folded again.
   * Files-only tray (no shells) must stay open until the user collapses it.
   */
  const hadBashTabs = useRef<boolean | null>(null)
  useEffect(() => {
    const empty = tabs.length === 0
    const prev = hadBashTabs.current
    hadBashTabs.current = !empty
    if (empty && prev === true) {
      setToolsCollapsed(true)
    }
  }, [tabs.length, setToolsCollapsed])

  const installRuns = useInstallRunStore((s) => s.runs)
  const installList = Object.values(installRuns)
  const hasTabs = tabs.length > 0
  const hasInstalls = installList.length > 0
  // Modes for layout polish (empty strip vs tab strip vs open tray).
  const headerMode = !hasTabs && !hasInstalls ? 'idle' : collapsed ? 'tabs-collapsed' : 'tabs-open'

  return (
    <div
      ref={panelRef}
      className="tools-panel"
      data-tools-collapsed={collapsed ? 'true' : 'false'}
      data-tools-mode={headerMode}
      data-has-session={activeId ? 'true' : 'false'}
    >
      <div className="tools-header" data-mode={headerMode}>
        <div className="tools-header-lead">
          {/* Path chip opens Files. File sessions use Enclosed dir (no switch).
              Missing root → red "dir not exist"; click / action still switches. */}
          <div className="workdir-chip" ref={pathChipRef}>
            <Chip
              label={label}
              icon={
                workdirIsGit && !rootMissing ? <GitBranch size={12} /> : <Folder size={12} />
              }
              title={pathTitle}
              active={filesOn}
              danger={rootMissing}
              onClick={
                rootMissing
                  ? // Recover: open switch menu instead of dead Files expand.
                    () => openWorkspaceMenu(pathChipRef.current)
                  : () => {
                      if (filesOn) {
                        setToolsCollapsed(true)
                        return
                      }
                      // Opening Files on an empty shell mints the Workspace.
                      void (async () => {
                        if (!useSessionStore.getState().activeId) {
                          await useSessionStore.getState().createConversation({ openIn: 'here' })
                        }
                        setPanelSegment('files')
                      })()
                    }
              }
              onContextMenu={(event) => {
                event.preventDefault()
                void showMenu(pathContextItems(), {
                  x: event.clientX,
                  y: event.clientY
                })
              }}
              onAction={
                allowWorkdirSwitch
                  ? () => openWorkspaceMenu(pathChipRef.current)
                  : undefined
              }
              actionIcon={allowWorkdirSwitch ? <ArrowLeftRight size={11} /> : undefined}
              actionTitle={
                allowWorkdirSwitch
                  ? t('tools.switchWorkdirTitle', { shortcut: keys('⌘⇧O') })
                  : undefined
              }
            />
          </div>
          {/* Divider only when tabs / installs exist — avoids a lone rule after the path chip. */}
          {hasTabs || hasInstalls ? (
            <span className="tools-header-divider" aria-hidden="true" />
          ) : null}
        </div>

        {hasInstalls ? (
          <div className="tools-header-installs" aria-label={t('agents.installingGroup')}>
            {installList.map((run) => {
              const failed = run.status === 'error' || run.status === 'cancelled'
              const running = run.status === 'running'
              const label = t('agents.installingNamed', { name: run.name })
              return (
                <Chip
                  key={run.agentId}
                  label={label}
                  icon={
                    failed ? (
                      <Unplug size={12} className="terminal-tab-icon is-exited" />
                    ) : (
                      <Download
                        size={12}
                        className={
                          running
                            ? 'terminal-tab-icon is-running tools-install-icon'
                            : 'tools-install-icon'
                        }
                      />
                    )
                  }
                  emphasis={running}
                  muted={!running}
                  title={t('agents.installOpenSettings', { name: run.name })}
                  onClick={() => {
                    useSessionStore.getState().openSettings('agents', run.agentId)
                  }}
                  onClose={() => {
                    if (run.status === 'running') {
                      void window.vav.agents.installCancel?.(run.agentId)
                    } else {
                      void window.vav.agents.installClear?.(run.agentId)
                    }
                  }}
                  closeTitle={
                    run.status === 'running' ? t('agents.installStop') : t('tools.closeTab')
                  }
                />
              )
            })}
          </div>
        ) : null}
        {hasInstalls && hasTabs ? (
          <span className="tools-header-divider" aria-hidden="true" />
        ) : null}

        <div
          className="tools-header-tabs"
          data-empty={hasTabs ? 'false' : 'true'}
          aria-hidden={!hasTabs}
        >
          {tabs.map((tab) => {
            const on = !collapsed && segment === 'terminal' && tab.id === activeTabId
            // Agent-controlled tabs: bot icon (green when agent is executing).
            // Plain Shell tabs: terminal icon, no agent prefix.
            const isAgentTab = tab.isAgent || !!tab.agentId
            const status = tabStatus?.[tab.id] ?? 'idle'
            const exited = status === 'exited'
            // The VAV tab mirrors the built-in agent rather than owning a shell,
            // so its liveness is the turn, not the PTY.
            const running =
              tab.agentId === 'vav' || tab.isAgent ? agentRunning : status === 'running'
            const statusLabel = exited
              ? t('tools.status.exited')
              : running
                ? t('tools.status.running')
                : t('tools.status.idle')
            return (
              <Chip
                key={tab.id}
                label={tab.title}
                icon={
                  exited ? (
                    <Unplug size={12} className="terminal-tab-icon is-exited" />
                  ) : isAgentTab ? (
                    <Bot
                      size={12}
                      className={running ? 'agent-bot-icon is-running' : 'agent-bot-icon'}
                    />
                  ) : (
                    <TerminalIcon
                      size={12}
                      className={running ? 'terminal-tab-icon is-running' : 'terminal-tab-icon'}
                    />
                  )
                }
                active={on}
                emphasis={isAgentTab && !exited}
                muted={exited}
                title={`${tab.title} · ${statusLabel}`}
                onClick={() => {
                  if (on) {
                    setToolsCollapsed(true)
                    return
                  }
                  selectTab(activeId, tab.id)
                  setPanelSegment('terminal')
                }}
                onClose={() => closeShellTab(tab.id, tab.title, tab.isAgent)}
                closeTitle={t('tools.closeTab')}
              />
            )
          })}
        </div>

        <div className="tools-header-trail">
          <Button
            label={t('tools.newBashShort')}
            icon={<TerminalIcon size={12} />}
            size="sm"
            title={`${t('tools.newBash')} ${keys('⌘T')}`}
            onClick={createBash}
          />
          <Button
            icon={collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            size="sm"
            title={`${t('shortcut.toggleTools')} ${keys('⌘⇧E')}`}
            onClick={toggleToolsPanel}
          />
        </div>
      </div>

      {/* Below path/tabs chrome, above the tray body — not under the window edge. */}
      {!collapsed && (
        <div
          className="panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('tools.resizePanel')}
          title={t('tools.resizePanel')}
          onMouseDown={onResizeStart}
          onDoubleClick={onResizerDoubleClick}
        />
      )}

      <div
        className="tools-body"
        ref={bodyRef}
        data-collapsed={collapsed}
        data-resizing={dragHeight !== null}
        style={
          previewEdit && !collapsed
            ? // Cap inside the 50% preview dock; row animation still drives open/close.
              { maxHeight: '100%', minHeight: 0 }
            : undefined
        }
      >
        <div className="tools-body-clip">
          <div
            className="tools-body-well"
            style={
              previewEdit && !collapsed
                ? { height: openHeight, maxHeight: '100%' }
                : { height: openHeight }
            }
          >
            <div className="tools-pane" data-hidden={collapsed || segment !== 'files'}>
              <FilesPanel visible={!collapsed && segment === 'files'} />
            </div>
            <div className="tools-pane" data-hidden={collapsed || segment !== 'terminal'}>
              <TerminalPanel visible={!collapsed && segment === 'terminal'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
