import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelRight, X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { prefetchForPath } from '../lib/prefetchHeavy'
import { Button, EmptyState } from './ui'
import { SessionDetail, type FileSessionChromeProps } from './SessionDetail'
import { GitDiffPreview } from './GitChangesPanel'
import {
  GithubActionPreview,
  GithubPullPreview,
  GithubReleasePreview,
  GithubSitePreview
} from './GithubPanel'

const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })))

/**
 * Session surface with optional right file-preview drawer.
 * Workspace groups only aggregate/pin in the sidebar — there is no workspace
 * selection mode. Preview open state lives on sessionStore.
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

function pathHash(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

function widthKey(scope: string): string {
  return `vav.session-file-preview-width-${pathHash(scope || 'none')}`
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

/** After preview open/close width animation settles, re-fit all PTYs. */
function notifyTerminalResize(): void {
  window.dispatchEvent(new Event('vav:resize-end'))
}

/**
 * Session layout: agent is primary; file preview is a right drawer (session state).
 * workdir scopes same-directory session history when the conversation has a root.
 */
export function WorkspaceView({
  workdir,
  conversationId
}: {
  /** Project path for same-dir history, or null for unrooted sessions. */
  workdir: string | null
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId) || conversationId
  const attachContextFile = useSessionStore((s) => s.attachContextFile)
  const previewOpen = useSessionStore((s) => s.filePreviewOpen)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const setFilePreviewHost = useSessionStore((s) => s.setFilePreviewHost)
  const toggleFilePreview = useSessionStore((s) => s.toggleFilePreview)
  const closeFilePreview = useCallback((): void => {
    setFilePreviewOpen(false)
  }, [setFilePreviewOpen])
  const selectedPath = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath ?? null)
  const workspaceRoot = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const workspaceDirs = useWorkspaceStore((s) => s.workspaces[activeId]?.dirs)
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)

  const widthScope = workdir || activeId || 'session'
  const [previewWidth, setPreviewWidth] = useState(
    () => loadStoredWidth(widthKey(widthScope), PREVIEW_MIN) ?? PREVIEW_FALLBACK_PX
  )
  /** Mount FileViewer only after the drawer has been opened once. */
  const [previewMounted, setPreviewMounted] = useState(false)
  const needsDefaultRatio = useRef(loadStoredWidth(widthKey(widthScope), PREVIEW_MIN) == null)

  const rootRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const previewWidthRef = useRef(previewWidth)
  previewWidthRef.current = previewWidth
  const colDraggingRef = useRef(false)

  useEffect(() => {
    setFilePreviewHost(true)
    return () => setFilePreviewHost(false)
  }, [setFilePreviewHost])

  useEffect(() => {
    if (activeId) void ensureFilesLoaded(activeId)
  }, [activeId, ensureFilesLoaded, workdir])

  useEffect(() => {
    const stored = loadStoredWidth(widthKey(widthScope), PREVIEW_MIN)
    needsDefaultRatio.current = stored == null
    setPreviewWidth(stored ?? PREVIEW_FALLBACK_PX)
    setPreviewMounted(false)
  }, [widthScope])

  useEffect(() => {
    if (previewOpen) setPreviewMounted(true)
    // Preview width animates (~sheet duration). Re-fit PTY after settle so
    // CLI agents expand to the full agent column.
    const timer = window.setTimeout(() => notifyTerminalResize(), 280)
    return () => window.clearTimeout(timer)
  }, [previewOpen, previewWidth])

  const persistWidth = useCallback(
    (value: number): void => {
      try {
        localStorage.setItem(widthKey(widthScope), String(value))
      } catch {
        // ignore
      }
    },
    [widthScope]
  )

  const fitToShell = useCallback((): void => {
    if (colDraggingRef.current) return
    const total = rootRef.current?.clientWidth ?? 0
    if (total <= 0 || !previewOpen) return
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
      notifyTerminalResize()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /**
   * Preview only real files. Directory selection still drives tree highlight
   * via selectedPath, but must not open FileViewer.
   */
  const previewFilePath = useMemo((): string | null => {
    if (!selectedPath) return null
    if (selectedPath === workspaceRoot || (workdir && selectedPath === workdir)) return null
    for (const entries of Object.values(workspaceDirs ?? {})) {
      const hit = entries.find((e) => e.path === selectedPath)
      if (hit) return hit.isDirectory ? null : selectedPath
    }
    return selectedPath
  }, [selectedPath, workspaceRoot, workspaceDirs, workdir])

  // Auto-attach File Attachment Chip for VAV when the preview file changes.
  useEffect(() => {
    if (!activeId) return
    if (previewFilePath) void attachContextFile(activeId, previewFilePath)
    else void attachContextFile(activeId, null)
  }, [activeId, previewFilePath, attachContextFile])

  useEffect(() => {
    prefetchForPath(previewFilePath)
  }, [previewFilePath])

  // Compact chrome: preview toggle only — no session title / history (sidebar).
  const fileSessionChrome: FileSessionChromeProps = {
    title: '',
    sessions: [],
    activeSessionId: activeId || null,
    historyOpen: false,
    historyAnchorRef: { current: null },
    onToggleHistory: () => undefined,
    onCloseHistory: () => undefined,
    onSwitchSession: () => undefined,
    onRenameSession: async () => undefined,
    onDeleteSessions: () => undefined,
    onNewSession: () => undefined,
    trail: (
      <Button
        /* Counterpart of left-sidebar PanelLeft — same glyph family, right side. */
        icon={<PanelRight size={14} />}
        size="sm"
        variant="ghost"
        className={previewOpen ? 'is-active-toggle' : undefined}
        title={previewOpen ? t('workspace.hidePreview') : t('workspace.showPreview')}
        onClick={() => toggleFilePreview()}
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
              notifyTerminalResize()
            }}
          />
          {previewMounted && sessionPreview.kind === 'git' ? (
            <GitDiffPreview
              cwd={sessionPreview.cwd}
              entry={sessionPreview.entry}
              onClose={closeFilePreview}
            />
          ) : previewMounted && sessionPreview.kind === 'github' ? (
            <GithubPullPreview
              key={`pull-${sessionPreview.pull.number}`}
              cwd={sessionPreview.cwd}
              pull={sessionPreview.pull}
              onClose={closeFilePreview}
            />
          ) : previewMounted && sessionPreview.kind === 'github-action' ? (
            <GithubActionPreview
              key={`run-${sessionPreview.run.id}`}
              cwd={sessionPreview.cwd}
              run={sessionPreview.run}
              onClose={closeFilePreview}
            />
          ) : previewMounted && sessionPreview.kind === 'github-site' ? (
            <GithubSitePreview site={sessionPreview.site} onClose={closeFilePreview} />
          ) : previewMounted && sessionPreview.kind === 'github-release' ? (
            <GithubReleasePreview
              key={`release-${sessionPreview.release.id}`}
              release={sessionPreview.release}
              onClose={closeFilePreview}
            />
          ) : previewMounted && previewFilePath ? (
            <Suspense
              fallback={<div className="muted" style={{ padding: 24 }}>{t('common.loading')}</div>}
            >
              <FileViewer
                path={previewFilePath}
                origin="session"
                parentConversationId={activeId}
                embedded
                onClose={closeFilePreview}
              />
            </Suspense>
          ) : (
            <div className="workspace-preview-empty">
              <div className="workspace-preview-empty-bar">
                <span className="spacer" />
                <Button
                  icon={<X size={14} />}
                  size="sm"
                  title={t('common.close')}
                  onClick={closeFilePreview}
                />
              </div>
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

/** @deprecated use setFilePreviewOpen — kept for any external callers. */
export function useSessionFilePreview(): {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
} {
  const open = useSessionStore((s) => s.filePreviewOpen)
  const setOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const toggle = useSessionStore((s) => s.toggleFilePreview)
  return { open, setOpen, toggle }
}
