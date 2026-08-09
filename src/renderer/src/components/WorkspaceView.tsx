import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { FileSessionMeta } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { prefetchForPath } from '../lib/prefetchHeavy'
import { Button, EmptyState } from './ui'
import { SessionDetail, type FileSessionChromeProps } from './SessionDetail'

const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })))

/**
 * Preview drawer (workspace-view): the agent is the main column and the file
 * preview is a collapsible right panel. Width is path-scoped and persisted;
 * the open/closed state is not — every visit starts collapsed.
 */
const PREVIEW_MIN = 320
/** First-open / double-click reset width as a fraction of the shell. */
const PREVIEW_DEFAULT_RATIO = 0.42
/** Hard ceiling as a fraction of the workspace split width. */
const PREVIEW_MAX_RATIO = 0.6
/** Fallback before the shell is measured (tight windows only). */
const PREVIEW_FALLBACK_PX = 380
/** The agent is the primary surface — never squeeze it below this. */
const AGENT_MIN = 360

function pathHash(workdir: string): string {
  let hash = 0
  for (let i = 0; i < workdir.length; i++) hash = (hash * 31 + workdir.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

function widthKey(workdir: string): string {
  return `vav.workspace-preview-panel-width-${pathHash(workdir)}`
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

/** Max preview width for the current shell — 60%, but never starve the agent. */
function maxPreviewForShell(total: number): number {
  if (total <= 0) return PREVIEW_FALLBACK_PX
  const byRatio = Math.floor(total * PREVIEW_MAX_RATIO)
  const byAgent = total - AGENT_MIN
  return Math.max(PREVIEW_MIN, Math.min(byRatio, byAgent))
}

/** Default preview width — 42% of shell, within min/max. */
function defaultPreviewForShell(total: number): number {
  if (total <= 0) return PREVIEW_FALLBACK_PX
  return clamp(Math.floor(total * PREVIEW_DEFAULT_RATIO), PREVIEW_MIN, maxPreviewForShell(total))
}

/**
 * Workspace View: the agent is the surface you land on; the file preview is a
 * right drawer you pull open when you want it (default collapsed).
 * No left file tree — open a file from the main Files panel.
 *
 * Chrome matches file-session: one agent row — agent · title · history · + ·
 * search · preview toggle (no separate session head).
 */
export function WorkspaceView({ workdir }: { workdir: string }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const conversations = useSessionStore((s) => s.conversations)
  const createConversation = useSessionStore((s) => s.createConversation)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const attachContextFile = useSessionStore((s) => s.attachContextFile)
  const selectedPath = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath ?? null)
  const workspaceRoot = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const workspaceDirs = useWorkspaceStore((s) => s.workspaces[activeId]?.dirs)
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)

  const [previewWidth, setPreviewWidth] = useState(
    () => loadStoredWidth(widthKey(workdir), PREVIEW_MIN) ?? PREVIEW_FALLBACK_PX
  )
  const [previewOpen, setPreviewOpen] = useState(false)
  /** Mount FileViewer only after the drawer has been opened once — selecting a
   *  file while collapsed must not run FileViewer.prepareFileWorkspace (that
   *  used to re-root / clear the Files tree and flash the panel). */
  const [previewMounted, setPreviewMounted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyAnchorRef = useRef<HTMLButtonElement | null>(null)
  /** When no path-scoped width is stored, apply the ratio once measured. */
  const needsDefaultRatio = useRef(loadStoredWidth(widthKey(workdir), PREVIEW_MIN) == null)

  const rootRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const previewWidthRef = useRef(previewWidth)
  previewWidthRef.current = previewWidth
  const colDraggingRef = useRef(false)

  useEffect(() => {
    if (activeId) void ensureFilesLoaded(activeId)
  }, [activeId, ensureFilesLoaded, workdir])

  useEffect(() => {
    const stored = loadStoredWidth(widthKey(workdir), PREVIEW_MIN)
    needsDefaultRatio.current = stored == null
    setPreviewWidth(stored ?? PREVIEW_FALLBACK_PX)
    setPreviewOpen(false)
    setPreviewMounted(false)
    setHistoryOpen(false)
  }, [workdir])

  useEffect(() => {
    if (previewOpen) setPreviewMounted(true)
  }, [previewOpen])

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
    if (total <= 0 || !previewOpen) return
    // First open for this workdir: land at the default ratio of the split.
    if (needsDefaultRatio.current) {
      needsDefaultRatio.current = false
      const next = defaultPreviewForShell(total)
      setPreviewWidth(next)
      persistWidth(next)
      return
    }
    const maxPreview = maxPreviewForShell(total)
    let preview = previewWidthRef.current
    if (preview <= maxPreview && preview >= PREVIEW_MIN) return
    preview = clamp(preview, PREVIEW_MIN, maxPreview)
    if (preview === previewWidthRef.current) return
    setPreviewWidth(preview)
    persistWidth(preview)
  }, [previewOpen, persistWidth])

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
    const startPreview = previewWidth
    const shellW = rootRef.current?.clientWidth ?? 0
    let latestPreview = startPreview
    let raf = 0
    let pendingX = startX

    colDraggingRef.current = true
    document.documentElement.dataset.resizing = 'true'
    rootRef.current?.classList.add('is-col-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const applyDom = (preview: number): void => {
      if (previewRef.current && previewOpen) {
        previewRef.current.style.width = `${preview}px`
      }
    }

    const onMove = (e: MouseEvent): void => {
      pendingX = e.clientX
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const total = rootRef.current?.clientWidth || shellW
        // Resizer is on the drawer's left edge: dragging left widens it.
        const raw = startPreview + (startX - pendingX)
        latestPreview = clamp(raw, PREVIEW_MIN, maxPreviewForShell(total))
        applyDom(latestPreview)
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
      setPreviewWidth(latestPreview)
      persistWidth(latestPreview)
      window.dispatchEvent(new Event('vav:resize-end'))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /**
   * Preview only real files. Directory selection (column chrome / folder click)
   * still drives tree highlight via selectedPath, but must not open FileViewer —
   * inspect used to mislabel folders as binary ("Binary Workspace" + Open with…).
   */
  const previewFilePath = useMemo((): string | null => {
    if (!selectedPath) return null
    if (selectedPath === workspaceRoot || selectedPath === workdir) return null
    for (const entries of Object.values(workspaceDirs ?? {})) {
      const hit = entries.find((e) => e.path === selectedPath)
      if (hit) return hit.isDirectory ? null : selectedPath
    }
    // Path not in loaded tree (e.g. agent-created file): allow preview attempt.
    return selectedPath
  }, [selectedPath, workspaceRoot, workspaceDirs, workdir])

  // Auto-attach (replace) File Attachment Chip for the built-in VAV agent when
  // the preview *file* changes. Never attach a directory. CLI / Bash hosts are
  // not auto-pasted on click — use Files → Insert information to agent.
  useEffect(() => {
    if (!activeId) return
    if (previewFilePath) void attachContextFile(activeId, previewFilePath)
    else void attachContextFile(activeId, null)
  }, [activeId, previewFilePath, attachContextFile])

  useEffect(() => {
    prefetchForPath(previewFilePath)
  }, [previewFilePath])

  const sessions: FileSessionMeta[] = useMemo(() => {
    const msgs = useSessionStore.getState().messages
    return conversations
      .filter((c) => !c.archived && !c.fileId)
      .filter((c) => c.workingDirectory === workdir)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        if (a.pinned && b.pinned) return (b.pinTime ?? 0) - (a.pinTime ?? 0)
        return b.updatedAt - a.updatedAt
      })
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: msgs[c.id]?.length ?? 0,
        tokensUsed: c.tokensUsed ?? 0
      }))
  }, [conversations, workdir])

  const activeInWorkspace = sessions.some((s) => s.id === activeId)
    ? activeId
    : (sessions[0]?.id ?? null)
  const sessionTitle =
    (activeInWorkspace
      ? conversations.find((c) => c.id === activeInWorkspace)?.title
      : null) || t('common.session')

  const fileSessionChrome: FileSessionChromeProps = {
    title: sessionTitle,
    sessions,
    activeSessionId: activeInWorkspace,
    historyOpen,
    historyAnchorRef,
    onToggleHistory: () => setHistoryOpen((v) => !v),
    onCloseHistory: () => setHistoryOpen(false),
    onSwitchSession: (id) => {
      void selectConversation(id, { stayInWorkspace: true })
    },
    onRenameSession: (id, title) => renameConversation(id, title),
    onDeleteSessions: (ids) => requestDelete(ids),
    onNewSession: () => {
      void createConversation({ workingDirectory: workdir })
    },
    trail: (
      <Button
        icon={previewOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        size="sm"
        variant="ghost"
        title={previewOpen ? t('workspace.hidePreview') : t('workspace.showPreview')}
        onClick={() => setPreviewOpen((v) => !v)}
      />
    )
  }

  return (
    <div className="workspace-view preview-right" ref={rootRef}>
      <section className="workspace-view-agent">
        <SessionDetail variant="workspace" fileSessionChrome={fileSessionChrome} />
      </section>

      <aside
        ref={previewRef}
        className={`workspace-view-preview${previewOpen ? '' : ' is-collapsed'}`}
        style={{ width: previewOpen ? previewWidth : 0 }}
        aria-hidden={!previewOpen}
      >
        {/* Keep content mounted while width animates; fixed inner width so
            overflow on the aside clips without reflowing the preview. */}
        <div
          className={`workspace-view-preview-inner${previewOpen ? '' : ' is-collapsed'}`}
          style={{ width: previewWidth }}
        >
          <div
            className="workspace-col-resizer workspace-col-resizer-start"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizePreviewPanel')}
            onMouseDown={startResize}
            onDoubleClick={() => {
              const total = rootRef.current?.clientWidth ?? 0
              const next = defaultPreviewForShell(total)
              setPreviewWidth(next)
              persistWidth(next)
            }}
          />
          {previewMounted && previewFilePath ? (
            <Suspense
              fallback={<div className="muted" style={{ padding: 24 }}>{t('common.loading')}</div>}
            >
              <FileViewer
                path={previewFilePath}
                origin="session"
                parentConversationId={activeId}
                embedded
              />
            </Suspense>
          ) : (
            <div className="workspace-preview-empty">
              <EmptyState
                title={t('workspace.selectFile')}
                description={t('workspace.selectFileDesc')}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
