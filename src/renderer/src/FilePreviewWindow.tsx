import { useEffect, useLayoutEffect, useState } from 'react'
import { basename } from './lib/path'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  useSessionStore
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge } from './state/workspaceStore'
import { tt } from './i18n/useT'
import { AppToast } from './components/AppToast'
import { PreviewPerfHud } from './components/PreviewPerfHud'
import { useTerminalAppearance } from './lib/useTerminalAppearance'
import { useMenuCommands } from './lib/menuCommands'
import { prefetchPreviewCanvases } from './lib/prefetchHeavy'
import { previewOpenElapsed, setPreviewOpenClock } from './lib/previewOpenClock'

import { loadFileViewer, loadedFileViewer } from './lib/fileViewerModule'

function markPreview(label: string): void {
  try {
    performance.mark(`preview:${label}`)
  } catch {
    // ignore
  }
  if (import.meta.env.DEV) {
    const elapsed = previewOpenElapsed()
    const since = elapsed == null ? '' : ` (+${elapsed}ms since open)`
    console.debug(`[preview-perf] ${label}`, performance.now().toFixed(1), since)
  }
}

/**
 * Standalone file preview window — one path per window; reopen focuses it.
 * Warm shells start with empty path and receive `onPreviewNavigate`.
 */
export default function FilePreviewWindow({
  path: initialPath
}: {
  path: string
}): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const params = new URLSearchParams(window.location.search)
  const warmMode = params.get('warm')
  const warmShell = warmMode === '1' || warmMode === 'deep'
  const requestedAtParam = Number(params.get('requestedAt')) || 0
  const [path, setPath] = useState(initialPath || '')
  const [origin, setOrigin] = useState<'dock' | 'session'>(
    params.get('origin') === 'dock' ? 'dock' : 'session'
  )
  const [parentConversationId, setParentConversationId] = useState<string | null>(
    params.get('conversationId')
  )
  const [openSeq, setOpenSeq] = useState(0)
  const [Viewer, setViewer] = useState(() => loadedFileViewer())

  useEffect(() => {
    if (Viewer) return
    let alive = true
    void loadFileViewer().then((component) => {
      if (alive) setViewer(() => component)
    })
    return () => {
      alive = false
    }
  }, [Viewer])

  useEffect(() => {
    setPreviewOpenClock(requestedAtParam)
    document.title = path ? basename(path) || tt('common.preview') : tt('common.preview')
    // Light bootstrap: settings only — skip selectConversation so open is fast.
    void bootstrap(parentConversationId ?? undefined, { light: true }).then(() => {
      markPreview('bootstrap-ready')
      window.vav.window.previewShellReady?.()
    })
  }, [bootstrap, parentConversationId, requestedAtParam])

  // Idle shell (fresh warm boot or re-parked after close): pull every format
  // canvas in now so the next claim is paint-only. A shell that already holds a
  // path must not compete with the file the user is waiting on.
  useEffect(() => {
    if (path) return
    prefetchPreviewCanvases(warmMode === 'deep')
  }, [path, warmMode])

  // Splits "shell re-rendered for the new path" from "FileViewer mounted", so a
  // slow open can be blamed on React/lazy resolution vs. the canvas itself.
  useLayoutEffect(() => {
    if (!path) return
    markPreview(`shell-committed:${openSeq}`)
  }, [path, openSeq])

  useEffect(() => {
    const off = window.vav.window.onPreviewNavigate?.((payload) => {
      try {
        performance.clearMarks()
      } catch {
        // ignore
      }
      setPreviewOpenClock(payload.requestedAt)
      markPreview(`navigate:${payload.openSeq}`)
      setOpenSeq(payload.openSeq)
      setPath(payload.path || '')
      if (payload.origin === 'dock' || payload.origin === 'session') {
        setOrigin(payload.origin)
      }
      setParentConversationId(payload.conversationId ?? null)
      if (payload.path) {
        document.title = basename(payload.path) || tt('common.preview')
      }
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offMenu = installDefaultContextMenu()
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offUpdates = installUpdateBridge()
    return () => {
      offSettings()
      offMenu()
      offTurn()
      offFs()
      offPty()
      offUpdates()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()

  if (!ready) {
    return (
      <div className="file-preview-shell">
        <div className="file-viewer-header titlebar-drag">
          <div className="file-viewer-lead">
            <span className="file-viewer-name">
              {path ? basename(path) : tt('common.preview')}
            </span>
          </div>
          <span className="spacer" />
        </div>
        <div className="file-viewer-body muted" data-pad="text">
          {tt('common.loading')}
        </div>
      </div>
    )
  }

  // Warm pool idle — keep shell alive with no FileViewer work.
  if (!path) {
    return (
      <div className="file-preview-shell" data-warm={warmShell ? '1' : undefined}>
        <div className="file-viewer-header titlebar-drag">
          <div className="file-viewer-lead">
            <span className="file-viewer-name">{tt('common.preview')}</span>
          </div>
          <span className="spacer" />
        </div>
        <div className="file-viewer-body muted" data-pad="text" />
      </div>
    )
  }

  return (
    <>
      {Viewer ? (
        <Viewer
          key={`${path}::${openSeq}`}
          path={path}
          origin={origin}
          parentConversationId={parentConversationId}
        />
      ) : (
        <div className="file-viewer-body muted" data-pad="text">
          {tt('common.loading')}
        </div>
      )}
      <PreviewPerfHud />
      <AppToast />
    </>
  )
}
