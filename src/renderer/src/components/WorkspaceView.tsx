import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Folder, Plus } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import { useSessionStore, type TurnRuntime } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { relativeTime, truncatePathLabel } from '../lib/format'
import { Button, EmptyState } from './ui'
import { FileViewer } from './FileViewer'
import { SessionDetail } from './SessionDetail'

/**
 * Agent column (workspace-view): Preview + Agent split.
 * Default 340 / min 240 / max 480; path-scoped persistence.
 */
const AGENT_MIN = 240
const AGENT_MAX = 480
const AGENT_DEFAULT = 340
const PREVIEW_MIN = 320

function pathHash(workdir: string): string {
  let hash = 0
  for (let i = 0; i < workdir.length; i++) hash = (hash * 31 + workdir.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

function widthKey(workdir: string): string {
  return `vav.workspace-agent-panel-width-${pathHash(workdir)}`
}

function loadStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(localStorage.getItem(key))
    if (Number.isFinite(n) && n >= min && n <= max) return Math.round(n)
  } catch {
    // ignore
  }
  return fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Workspace View: two-pane Preview + Agent.
 * No left file tree — open a file from the main Files panel (or keep none selected).
 * Agent panel: session dropdown + New.
 */
export function WorkspaceView({ workdir }: { workdir: string }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const createConversation = useSessionStore((s) => s.createConversation)
  const attachContextFile = useSessionStore((s) => s.attachContextFile)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)

  const [agentWidth, setAgentWidth] = useState(() =>
    loadStoredWidth(widthKey(workdir), AGENT_DEFAULT, AGENT_MIN, AGENT_MAX)
  )
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)

  const rootRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth
  const colDraggingRef = useRef(false)

  const revealAgent = useCallback((): void => {
    setAgentPanelOpen(true)
  }, [])

  useEffect(() => {
    if (activeId) void ensureFilesLoaded(activeId)
  }, [activeId, ensureFilesLoaded, workdir])

  useEffect(() => {
    setAgentWidth(loadStoredWidth(widthKey(workdir), AGENT_DEFAULT, AGENT_MIN, AGENT_MAX))
    setAgentPanelOpen(true)
  }, [workdir])

  const persistWidth = useCallback(
    (value: number): void => {
      try {
        localStorage.setItem(widthKey(workdir), String(value))
      } catch {
        // ignore
      }
    },
    [workdir]
  )

  const fitToShell = useCallback((): void => {
    if (colDraggingRef.current) return
    const total = rootRef.current?.clientWidth ?? 0
    if (total <= 0 || !agentPanelOpen) return
    let agent = agentWidthRef.current
    const budget = total - PREVIEW_MIN
    if (agent <= budget) return
    agent = Math.max(AGENT_MIN, budget)
    if (agent === agentWidthRef.current) return
    setAgentWidth(agent)
    persistWidth(agent)
  }, [agentPanelOpen, persistWidth])

  useEffect(() => {
    fitToShell()
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitToShell())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToShell])

  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startAgent = agentWidth
    const shellW = rootRef.current?.clientWidth ?? 0
    let latestAgent = startAgent
    let raf = 0
    let pendingX = startX

    colDraggingRef.current = true
    document.documentElement.dataset.resizing = 'true'
    rootRef.current?.classList.add('is-col-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const applyDom = (agent: number): void => {
      if (agentRef.current && agentPanelOpen) {
        agentRef.current.style.width = `${agent}px`
      }
    }

    const onMove = (e: MouseEvent): void => {
      pendingX = e.clientX
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const total = rootRef.current?.clientWidth || shellW
        const raw = startAgent + (startX - pendingX)
        const maxForAgent = Math.min(AGENT_MAX, Math.max(AGENT_MIN, total - PREVIEW_MIN))
        latestAgent = clamp(raw, AGENT_MIN, maxForAgent)
        applyDom(latestAgent)
      })
    }

    const onUp = (): void => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      rootRef.current?.classList.remove('is-col-resizing')
      colDraggingRef.current = false
      delete document.documentElement.dataset.resizing
      setAgentWidth(latestAgent)
      persistWidth(latestAgent)
      window.dispatchEvent(new Event('vav:resize-end'))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const selectedPath = workspace?.selectedPath ?? null

  // Auto-attach (replace) File Attachment Chip when the preview file changes.
  // Dismiss stays until selectedPath changes again — we do not re-attach on every
  // render while the same path is still selected.
  // CLI agents receive focus only at process spawn (argv / system-prompt file),
  // not via mid-session PTY paste (which would print into the TUI).
  useEffect(() => {
    if (!activeId) return
    if (selectedPath) void attachContextFile(activeId, selectedPath)
  }, [activeId, selectedPath, attachContextFile])

  const newSession = async (): Promise<void> => {
    await createConversation({ workingDirectory: workdir })
  }

  return (
    <div className="workspace-view" ref={rootRef}>
      <section className="workspace-view-preview" ref={previewRef}>
        {selectedPath ? (
          <FileViewer
            path={selectedPath}
            origin="session"
            parentConversationId={activeId}
            embedded
            agentPanelOpen={agentPanelOpen}
            onToggleAgentPanel={() => setAgentPanelOpen((v) => !v)}
            onPickBlock={revealAgent}
          />
        ) : (
          <EmptyState
            title={t('workspace.selectFile')}
            description={t('workspace.selectFileDesc')}
          />
        )}
      </section>

      <aside
        ref={agentRef}
        className={`workspace-view-agent${agentPanelOpen ? '' : ' is-collapsed'}`}
        style={{ width: agentPanelOpen ? agentWidth : 0 }}
        aria-hidden={!agentPanelOpen}
      >
        {agentPanelOpen && (
          <>
            <div
              className="workspace-col-resizer workspace-col-resizer-start"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('workspace.resizeAgentPanel')}
              onMouseDown={startResize}
              onDoubleClick={() => {
                setAgentWidth(AGENT_DEFAULT)
                persistWidth(AGENT_DEFAULT)
              }}
            />
            <div className="workspace-view-agent-head">
              <div className="workspace-view-agent-head-row">
                <Folder size={14} aria-hidden className="workspace-view-agent-folder" />
                <span className="workspace-view-agent-path" title={workdir}>
                  {truncatePathLabel(workdir, 36)}
                </span>
              </div>
              <div className="workspace-view-agent-head-row workspace-view-agent-session">
                <WorkspaceSessionSelect workdir={workdir} />
                <Button
                  icon={<Plus size={12} />}
                  size="sm"
                  variant="secondary"
                  title={t('workspace.newSession')}
                  onClick={() => void newSession()}
                />
              </div>
            </div>
            <SessionDetail variant="workspace" />
          </>
        )}
      </aside>
    </div>
  )
}

/**
 * Session dropdown for this workspace — switch conversation without leaving
 * workspace view (stayInWorkspace).
 */
function WorkspaceSessionSelect({ workdir }: { workdir: string }): React.JSX.Element {
  const t = useT()
  const conversations = useSessionStore((s) => s.conversations)
  const turns = useSessionStore((s) => s.turns)
  const activeId = useSessionStore((s) => s.activeId)
  const selectConversation = useSessionStore((s) => s.selectConversation)

  const rows = useMemo(() => {
    return conversations
      .filter((c) => !c.archived && !c.fileId)
      .filter((c) => c.workingDirectory === workdir)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        if (a.pinned && b.pinned) return (b.pinTime ?? 0) - (a.pinTime ?? 0)
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, workdir])

  const optionLabel = (c: ConversationMeta): string => {
    const turn = turns[c.id] as TurnRuntime | undefined
    const title = (c.title || t('common.session')).trim()
    if (turn?.awaitingToolCallId) {
      return t('workspace.sessionOptionAwaiting', { title })
    }
    if (turn?.isRunning) {
      return t('workspace.sessionOptionRunning', { title })
    }
    const when = relativeTime(c.updatedAt)
    if (c.pinned) return t('workspace.sessionOptionPinned', { title, when })
    return t('workspace.sessionOption', { title, when })
  }

  const value = rows.some((c) => c.id === activeId) ? activeId : (rows[0]?.id ?? '')

  return (
    <label className="workspace-session-select preview-mode">
      <span className="preview-mode-control">
        <select
          className="text-field preview-mode-select workspace-session-select-field"
          value={value}
          disabled={rows.length === 0}
          aria-label={t('workspace.sessionSelect')}
          title={t('workspace.historyTitle')}
          onChange={(e) => {
            const id = e.target.value
            if (id) void selectConversation(id, { stayInWorkspace: true })
          }}
        >
          {rows.length === 0 ? (
            <option value="">{t('workspace.historyEmpty').split('\n')[0]}</option>
          ) : (
            rows.map((c) => (
              <option key={c.id} value={c.id}>
                {optionLabel(c)}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="preview-mode-chevron" size={12} aria-hidden />
      </span>
    </label>
  )
}
