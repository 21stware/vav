import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import type { FileSessionListEntry } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'
import { EmptyState } from './ui'
import { SessionDetail } from './SessionDetail'
import { ShellLeadingControls } from './ShellLeadingControls'
import { useSidebarFloatMode } from '../lib/sidebarLayout'

const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })))

const AGENT_MIN = 280
const AGENT_DEFAULT = 380
const AGENT_WIDTH_KEY = 'vav.file-session-agent-width'

function loadAgentWidth(): number {
  try {
    const n = Number(localStorage.getItem(AGENT_WIDTH_KEY))
    if (Number.isFinite(n) && n >= AGENT_MIN) return Math.round(n)
  } catch {
    // ignore
  }
  return AGENT_DEFAULT
}

/**
 * Main-shell surface for a file-bound session: file canvas + agent chat.
 * Session list lives only in the sidebar — no nested “Open chat” title bar
 * (one AgentModeChrome row, aligned with the file header).
 */
export function FileSessionView({
  conversationId,
  fileId
}: {
  conversationId: string
  fileId: string
}): React.JSX.Element {
  const t = useT()
  const [resolved, setResolved] = useState<{
    path: string
    pathStatus: FileSessionListEntry['pathStatus']
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentWidth, setAgentWidth] = useState(loadAgentWidth)
  const [agentOpen, setAgentOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth

  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)
  const shellLeading = showShellLeading ? <ShellLeadingControls /> : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.vav.fileSessions.resolve(fileId).then((next) => {
      if (cancelled) return
      setResolved(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fileId])

  const startResize = useCallback(
    (event: React.MouseEvent): void => {
      event.preventDefault()
      const startX = event.clientX
      const startW = agentWidthRef.current
      const onMove = (ev: MouseEvent): void => {
        const total = rootRef.current?.clientWidth ?? 800
        const max = Math.max(AGENT_MIN, Math.floor(total * 0.7))
        const next = Math.min(max, Math.max(AGENT_MIN, startW - (ev.clientX - startX)))
        setAgentWidth(next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        try {
          localStorage.setItem(AGENT_WIDTH_KEY, String(agentWidthRef.current))
        } catch {
          // ignore
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    []
  )

  const pathOk = resolved?.pathStatus === 'ok' && !!resolved.path
  // Canvas is always about the *file* — even when the parent folder is gone.
  // "dir not exist" is reserved for the tools Enclosed-dir chip, not this empty.
  const missingName = resolved?.path ? basename(resolved.path) : ''

  /** Placeholder header so missing/loading states are not a bald void. */
  const missingChrome = (
    <header
      className={`file-viewer-header file-session-missing-header${shellLeading ? ' has-shell-leading' : ''}`}
    >
      <div className="file-viewer-lead">
        {shellLeading ? (
          <div className="file-viewer-shell-leading">{shellLeading}</div>
        ) : null}
        <span className="file-viewer-name" title={resolved?.path ?? undefined}>
          {missingName || t('common.preview')}
        </span>
      </div>
      <span className="spacer" />
    </header>
  )

  return (
    <div className="workspace-view file-session-view" ref={rootRef}>
      <section className="workspace-view-preview file-session-preview">
        {loading ? (
          <div className="file-session-missing">
            {missingChrome}
            <div className="file-session-missing-body muted">{t('common.loading')}</div>
          </div>
        ) : pathOk ? (
          <Suspense fallback={<div className="file-session-missing-body muted">{t('common.loading')}</div>}>
            <FileViewer
              key={`${fileId}:${resolved!.path}`}
              path={resolved!.path}
              origin="session"
              parentConversationId={conversationId}
              embedded
              agentPanelOpen={agentOpen}
              onToggleAgentPanel={() => setAgentOpen((v) => !v)}
              onPickBlock={() => setAgentOpen(true)}
              shellLeading={shellLeading}
            />
          </Suspense>
        ) : (
          <div className="file-session-missing">
            {missingChrome}
            <div className="file-session-missing-body">
              <EmptyState
                title={t('sidebar.fileNotExist')}
                description={resolved?.path ?? undefined}
              />
            </div>
          </div>
        )}
      </section>

      <aside
        className={`workspace-view-agent${agentOpen ? '' : ' is-collapsed'}`}
        style={{ width: agentOpen ? agentWidth : 0 }}
        aria-hidden={!agentOpen}
      >
        <div
          className={`workspace-view-agent-inner${agentOpen ? '' : ' is-collapsed'}`}
          style={{ width: agentWidth }}
        >
          <div
            className="workspace-col-resizer workspace-col-resizer-start"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizeAgentPanel')}
            onMouseDown={startResize}
          />
          {/* No “Open chat” title strip — session list is the sidebar; AgentModeChrome
              is the sole top row (aligned with the file header). */}
          <SessionDetail variant="workspace" />
        </div>
      </aside>
    </div>
  )
}
