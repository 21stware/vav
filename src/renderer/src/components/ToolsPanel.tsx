import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Folder,
  Plus,
  Terminal as TerminalIcon,
  X
} from 'lucide-react'
import { useSessionStore, PANEL_MAX_HEIGHT, PANEL_MIN_HEIGHT } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { truncatePathLabel, workdirLabel } from '../lib/format'
import { FilesPanel } from './FilesPanel'
import { TerminalPanel } from './TerminalPanel'
import { disposeTerminal } from '../lib/terminalRegistry'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { FILE_MANAGER, keys } from '../lib/platform'
import { Button, Chip } from './ui'

/**
 * The tools台 between the transcript and the composer.
 *
 * Files and Terminal are both mounted; only visibility switches, and collapsing
 * takes the body to zero height without destroying either pane
 * (main-chat.rpml annotation 5).
 */
export function ToolsPanel(): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const collapsed = useSessionStore((s) => s.toolsCollapsed)
  const segment = useSessionStore((s) => s.panelSegment)
  const panelHeight = useSessionStore((s) => s.panelHeight)
  const tmp = useSessionStore((s) => s.tmp)
  const home = useSessionStore((s) => s.home)

  const toggleToolsPanel = useSessionStore((s) => s.toggleToolsPanel)
  const setPanelSegment = useSessionStore((s) => s.setPanelSegment)
  const setPanelHeight = useSessionStore((s) => s.setPanelHeight)
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)
  const showDialog = useSessionStore((s) => s.showDialog)

  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const newUserTerminal = useWorkspaceStore((s) => s.newUserTerminal)
  const selectTab = useWorkspaceStore((s) => s.selectTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)

  const workdir = conversation?.workingDirectory ?? null
  const label = truncatePathLabel(workdirLabel(workdir, tmp, home))
  const tabs = workspace?.tabs ?? []
  const activeTabId = workspace?.activeTabId ?? ''

  // Dragging only recomputes a local height; the store is written once, on release.
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

  const pathMenuItems: MenuItem[] = [
    { label: '切换目录…', onSelect: () => void pickWorkingDirectory(activeId) },
    {
      label: '复制路径',
      disabled: !workdir,
      onSelect: () => void window.vav.conversations.copyToClipboard(workdir ?? '')
    },
    {
      label: `在 ${FILE_MANAGER} 中显示`,
      disabled: !workdir,
      onSelect: () => void window.vav.conversations.revealInFinder(workdir ?? '')
    }
  ]

  const bodyHeight = collapsed ? 0 : (dragHeight ?? panelHeight)

  return (
    <div className="tools-panel">
      {!collapsed && <div className="panel-resizer" onMouseDown={onResizeStart} />}

      <div className="tools-header">
        <Chip
          label={label}
          icon={<Folder size={12} />}
          title={workdir ?? 'Temporary Workspace'}
          active={!collapsed && segment === 'files'}
          onClick={() => setPanelSegment('files')}
          onContextMenu={(event) => {
            event.preventDefault()
            void showMenu(pathMenuItems)
          }}
        />
        <Button
          icon={<ArrowLeftRight size={12} />}
          size="sm"
          title={`切换工作目录 ${keys('⌘⇧O')}`}
          onClick={() => void pickWorkingDirectory(activeId)}
        />

        {/* The agent's bash tab is only here once the agent has opened one, so
            it is closable like any other — the next command brings it back. */}
        {tabs.map((tab) => (
          <span key={tab.id} className="tab-chip" data-agent={tab.isAgent}>
            <Chip
              label={tab.title}
              icon={tab.isAgent ? <Bot size={12} /> : <TerminalIcon size={12} />}
              active={!collapsed && segment === 'terminal' && tab.id === activeTabId}
              onClick={() => {
                selectTab(activeId, tab.id)
                setPanelSegment('terminal')
              }}
            />
            <Button
              icon={<X size={10} />}
              size="sm"
              title="关闭标签"
              onClick={() => {
                if (tab.isAgent) {
                  disposeTerminal(activeId, tab.id)
                  closeTab(activeId, tab.id)
                  return
                }
                showDialog({
                  title: '关闭将终止正在运行的命令',
                  body: `${tab.title} 中可能仍有命令在执行。关闭该标签会结束它的 shell 进程。`,
                  confirmLabel: '关闭',
                  destructive: true,
                  onConfirm: () => {
                    disposeTerminal(activeId, tab.id)
                    closeTab(activeId, tab.id)
                  }
                })
              }}
            />
          </span>
        ))}

        <Button
          label="New bash"
          icon={<Plus size={12} />}
          variant="secondary"
          size="sm"
          title={`新终端标签 ${keys('⌘T')}`}
          onClick={() => {
            setPanelSegment('terminal')
            void newUserTerminal(activeId, 80, 24)
          }}
        />

        <span className="spacer" />
        <Button
          icon={collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          size="sm"
          title={`显示/隐藏工具台 ${keys('⌘⇧E')}`}
          onClick={toggleToolsPanel}
        />
      </div>

      {/* Kept mounted at height 0 when collapsed, so neither pane is destroyed. */}
      <div className="tools-body" data-collapsed={collapsed} style={{ height: bodyHeight }}>
        <div className="tools-pane" data-hidden={collapsed || segment !== 'files'}>
          <FilesPanel visible={!collapsed && segment === 'files'} />
        </div>
        <div className="tools-pane" data-hidden={collapsed || segment !== 'terminal'}>
          <TerminalPanel visible={!collapsed && segment === 'terminal'} />
        </div>
      </div>
    </div>
  )
}
