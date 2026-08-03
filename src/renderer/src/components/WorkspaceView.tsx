import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { ConversationMeta } from '@shared/types'
import { useSessionStore, type TurnRuntime } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { Button, EmptyState } from './ui'
import { FileViewer } from './FileViewer'
import { SessionDetail } from './SessionDetail'

/**
 * Agent column (workspace-view): Preview + Agent split.
 * Default 60% / min 240 / max 70% of shell (and still leave PREVIEW_MIN);
 * path-scoped persistence.
 */
const AGENT_MIN = 240
/** First-open / double-click reset width as a fraction of the shell. */
const AGENT_DEFAULT_RATIO = 0.6
/** Hard ceiling as a fraction of the workspace split width. */
const AGENT_MAX_RATIO = 0.7
/** Fallback before the shell is measured (tight windows only). */
const AGENT_FALLBACK_PX = 340
const PREVIEW_MIN = 320

function pathHash(workdir: string): string {
  let hash = 0
  for (let i = 0; i < workdir.length; i++) hash = (hash * 31 + workdir.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

function widthKey(workdir: string): string {
  return `vav.workspace-agent-panel-width-${pathHash(workdir)}`
}

function loadStoredWidth(key: string, min: number): number | null {
  try {
    const n = Number(localStorage.getItem(key))
    if (Number.isFinite(n) && n >= min) return Math.round(n)
  } catch {
    // ignore
  }
  return null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Max agent width for the current shell — 70%, but never starve the preview. */
function maxAgentForShell(total: number): number {
  if (total <= 0) return AGENT_FALLBACK_PX
  const byRatio = Math.floor(total * AGENT_MAX_RATIO)
  const byPreview = total - PREVIEW_MIN
  return Math.max(AGENT_MIN, Math.min(byRatio, byPreview))
}

/** Default agent width — 60% of shell, within min/max. */
function defaultAgentForShell(total: number): number {
  if (total <= 0) return AGENT_FALLBACK_PX
  return clamp(Math.floor(total * AGENT_DEFAULT_RATIO), AGENT_MIN, maxAgentForShell(total))
}

/**
 * Workspace View: two-pane Preview + Agent.
 * No left file tree — open a file from the main Files panel (or keep none selected).
 * Agent panel: session dropdown + New (workdir is already visible in the
 * preview / files surface — no duplicate path row here).
 */
export function WorkspaceView({ workdir }: { workdir: string }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const createConversation = useSessionStore((s) => s.createConversation)
  const attachContextFile = useSessionStore((s) => s.attachContextFile)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)

  const [agentWidth, setAgentWidth] = useState(
    () => loadStoredWidth(widthKey(workdir), AGENT_MIN) ?? AGENT_FALLBACK_PX
  )
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  /** When no path-scoped width is stored, apply 60% once the shell is measured. */
  const needsDefaultRatio = useRef(loadStoredWidth(widthKey(workdir), AGENT_MIN) == null)

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
    const stored = loadStoredWidth(widthKey(workdir), AGENT_MIN)
    needsDefaultRatio.current = stored == null
    setAgentWidth(stored ?? AGENT_FALLBACK_PX)
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
    // First open for this workdir: land at 60% of the split.
    if (needsDefaultRatio.current) {
      needsDefaultRatio.current = false
      const next = defaultAgentForShell(total)
      setAgentWidth(next)
      persistWidth(next)
      return
    }
    const maxAgent = maxAgentForShell(total)
    let agent = agentWidthRef.current
    if (agent <= maxAgent && agent >= AGENT_MIN) return
    agent = clamp(agent, AGENT_MIN, maxAgent)
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
        latestAgent = clamp(raw, AGENT_MIN, maxAgentForShell(total))
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

  /**
   * Preview only real files. Directory selection (column chrome / folder click)
   * still drives tree highlight via selectedPath, but must not open FileViewer —
   * inspect used to mislabel folders as binary ("Binary Workspace" + Open with…).
   */
  const previewFilePath = useMemo((): string | null => {
    if (!selectedPath || !workspace) return null
    if (selectedPath === workspace.root || selectedPath === workdir) return null
    for (const entries of Object.values(workspace.dirs ?? {})) {
      const hit = entries.find((e) => e.path === selectedPath)
      if (hit) return hit.isDirectory ? null : selectedPath
    }
    // Path not in loaded tree (e.g. agent-created file): allow preview attempt.
    return selectedPath
  }, [selectedPath, workspace, workdir])

  // Auto-attach (replace) File Attachment Chip when the preview *file* changes.
  // Never attach a directory as context. Dismiss stays until path changes again.
  // CLI agents receive focus only at process spawn (argv / system-prompt file),
  // not via mid-session PTY paste (which would print into the TUI).
  useEffect(() => {
    if (!activeId) return
    if (previewFilePath) void attachContextFile(activeId, previewFilePath)
    else void attachContextFile(activeId, null)
  }, [activeId, previewFilePath, attachContextFile])

  const newSession = async (): Promise<void> => {
    await createConversation({ workingDirectory: workdir })
  }

  return (
    <div className="workspace-view" ref={rootRef}>
      <section className="workspace-view-preview" ref={previewRef}>
        {previewFilePath ? (
          <FileViewer
            path={previewFilePath}
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
                const total = rootRef.current?.clientWidth ?? 0
                const next = defaultAgentForShell(total)
                setAgentWidth(next)
                persistWidth(next)
              }}
            />
            <div className="workspace-view-agent-head">
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
