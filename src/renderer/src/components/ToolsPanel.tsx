import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Folder,
  Terminal as TerminalIcon,
  Unplug
} from 'lucide-react'
import { useSessionStore, PANEL_MAX_HEIGHT, PANEL_MIN_HEIGHT } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { basename } from '../lib/path'
import { isTemporaryWorkspace, truncatePathLabel, workdirLabel } from '../lib/format'
import { FilesPanel } from './FilesPanel'
import { TerminalPanel } from './TerminalPanel'
import { disposeTerminal } from '../lib/terminalRegistry'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel, keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button, Chip } from './ui'

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
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)
  const pathChipRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const seenMenuNonce = useRef(0)

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

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragState.current = { startY: event.clientY, startHeight: panelHeight }
      // Mark live tray drag: xterm still fits (tracks the pointer), but
      // terminalRegistry holds SIGWINCH until settle (ghost TUI frames).
      document.documentElement.dataset.resizing = 'true'
      setDragHeight(panelHeight)
    },
    [panelHeight]
  )

  useEffect(() => {
    if (dragHeight === null) return
    const onMove = (event: MouseEvent): void => {
      const state = dragState.current
      if (!state) return
      const next = state.startHeight - (event.clientY - state.startY)
      setDragHeight(Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, next)))
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
        await useSessionStore.getState().createConversation()
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

  return (
    <div className="tools-panel">
      {!collapsed && <div className="panel-resizer" onMouseDown={onResizeStart} />}

      <div className="tools-header">
        <div className="tools-header-lead">
          {/* Path chip opens Files. File sessions use Enclosed dir (no switch).
              Missing root → red "dir not exist"; click / action still switches. */}
          <div className="workdir-chip" ref={pathChipRef}>
            <Chip
              label={label}
              icon={<Folder size={12} />}
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
                          await useSessionStore.getState().createConversation()
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
          <span className="tools-header-divider" aria-hidden="true" />
        </div>

        <div className="tools-header-tabs">
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
