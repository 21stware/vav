import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Folder,
  Terminal as TerminalIcon
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

  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const newBash = useWorkspaceStore((s) => s.newBash)
  const selectTab = useWorkspaceStore((s) => s.selectTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)
  const pathChipRef = useRef<HTMLDivElement>(null)
  const seenMenuNonce = useRef(0)

  const workdir = conversation?.workingDirectory ?? null
  const temporary = isTemporaryWorkspace(workdir, tmp)
  const label = truncatePathLabel(workdirLabel(workdir, tmp, home))
  // Tools tray shows user bash only — never main-surface CLI agent hosts.
  const tabs = (workspace?.tabs ?? []).filter(
    (t) => !t.agentId || t.agentId === 'vav' || t.isAgent
  )
  const activeTabId = workspace?.activeTabId ?? ''
  const filesOn = !collapsed && segment === 'files'
  const previewEdit = variant === 'preview-edit'
  const agentRunning = useSessionStore((s) => !!s.turns[activeId]?.isRunning)

  const locateWorkspace = useSessionStore((s) => s.locateWorkspace)

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dragState.current = { startY: event.clientY, startHeight: panelHeight }
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
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
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
    openWorkspaceMenu(pathChipRef.current)
  }, [workspaceMenuNonce, openWorkspaceMenu])

  const pathContextItems = (): MenuItem[] => [
    ...workspaceSwitchItems(),
    { label: '', divider: true },
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

  const bodyHeight = collapsed ? 0 : (dragHeight ?? panelHeight)

  const createBash = (): void => {
    setPanelSegment('terminal')
    void newBash(activeId, 80, 24)
  }

  const setPanelSegmentQuiet = useSessionStore((s) => s.setPanelSegmentQuiet)

  // Preview-edit has no Files pane — keep segment on terminal for when the
  // tray is open. Quiet: does not expand this session's tools tray.
  useEffect(() => {
    if (!previewEdit || segment === 'terminal') return
    setPanelSegmentQuiet('terminal')
  }, [previewEdit, segment, setPanelSegmentQuiet])

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
          {/* Preview-edit (Agent in file preview): no Files path chip, no Pick —
              block pick is always-on when Editing; crosshair toggle removed. */}
          {!previewEdit && (
            <>
              <div className="workdir-chip" ref={pathChipRef}>
                <Chip
                  label={label}
                  icon={<Folder size={12} />}
                  title={workdir ?? t('sidebar.temporaryWorkspace')}
                  active={filesOn}
                  onClick={() => {
                    if (filesOn) setToolsCollapsed(true)
                    else setPanelSegment('files')
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    void showMenu(pathContextItems(), { x: event.clientX, y: event.clientY })
                  }}
                  onAction={() => openWorkspaceMenu(pathChipRef.current)}
                  actionIcon={<ArrowLeftRight size={11} />}
                  actionTitle={t('tools.switchWorkdirTitle', { shortcut: keys('⌘⇧O') })}
                />
              </div>
              <span className="tools-header-divider" aria-hidden="true" />
            </>
          )}
        </div>

        <div className="tools-header-tabs">
          {tabs.map((tab) => {
            const on = !collapsed && segment === 'terminal' && tab.id === activeTabId
            // Agent-controlled tabs: bot icon (green when agent is executing).
            // Plain Shell tabs: terminal icon, no agent prefix.
            const isAgentTab = tab.isAgent || !!tab.agentId
            const agentActive = isAgentTab && agentRunning && tab.id === activeTabId
            return (
              <Chip
                key={tab.id}
                label={tab.title}
                icon={
                  isAgentTab ? (
                    <Bot
                      size={12}
                      className={agentActive ? 'agent-bot-icon is-running' : 'agent-bot-icon'}
                    />
                  ) : (
                    <TerminalIcon size={12} />
                  )
                }
                active={on}
                emphasis={isAgentTab}
                title={tab.title}
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
        data-collapsed={collapsed}
        data-resizing={dragHeight !== null}
        style={
          collapsed
            ? { height: 0 }
            : previewEdit
              ? // Prefer panelHeight when the dock has room; shrink when the
                // agent drawer caps the dock at 50% so empty-state can center
                // in the visible box instead of a clipped midpoint.
                { height: bodyHeight, flex: '1 1 auto', minHeight: 0 }
              : { height: bodyHeight }
        }
      >
        {!previewEdit && (
          <div className="tools-pane" data-hidden={collapsed || segment !== 'files'}>
            <FilesPanel visible={!collapsed && segment === 'files'} />
          </div>
        )}
        <div className="tools-pane" data-hidden={collapsed || segment !== 'terminal'}>
          <TerminalPanel visible={!collapsed && segment === 'terminal'} />
        </div>
      </div>
    </div>
  )
}
