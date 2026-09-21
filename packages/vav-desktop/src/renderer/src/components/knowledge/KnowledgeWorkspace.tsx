import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import type { KnowledgeHost } from '@shared/knowledge'
import { FILE_SESSION_AGENT_MIN_WIDTH } from '@shared/shellMinSize'
import { useT } from '../../i18n/useT'
import { useSidebarFloatMode } from '../../lib/sidebarLayout'
import { startCapturedPointerDrag } from '../../lib/capturedPointerDrag'
import { reportFileSessionAgentOpen } from '../../lib/useWindowMinSize'
import { syncWorkspaceAgentFocusedPath } from '../../lib/workspaceAgentContext'
import { useSessionStore } from '../../state/sessionStore'
import { Button, EmptyState } from '../ui'
import { SessionDetail } from '../SessionDetail'
import { ShellLeadingControls } from '../ShellLeadingControls'
import { KnowledgeNoteEditor } from './KnowledgeNoteEditor'
import { basename } from '../../lib/path'

const AGENT_MIN = FILE_SESSION_AGENT_MIN_WIDTH
const AGENT_DEFAULT = 380
const AGENT_WIDTH_KEY = 'vav.knowledge-session-agent-width'

function loadAgentWidth(): number {
  try {
    const n = Number(localStorage.getItem(AGENT_WIDTH_KEY))
    if (Number.isFinite(n) && n >= AGENT_MIN) return Math.round(n)
  } catch {
    // ignore
  }
  return AGENT_DEFAULT
}

export function KnowledgeWorkspace({
  conversationId,
  hideAgent = false
}: {
  conversationId: string
  hideAgent?: boolean
}): React.JSX.Element {
  const t = useT()
  const hostId = useSessionStore(
    (s) => s.conversations.find((row) => row.id === conversationId)?.knowledgeHostId ?? null
  )
  const [host, setHost] = useState<KnowledgeHost | null>(null)
  const [agentWidth, setAgentWidth] = useState(loadAgentWidth)
  const [agentOpen, setAgentOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth

  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !hideAgent && !(sidebarVisible && !sidebarFloating)
  const shellLeading = showShellLeading ? <ShellLeadingControls /> : null

  useEffect(() => {
    reportFileSessionAgentOpen(agentOpen, agentWidth)
  }, [agentOpen, agentWidth])
  useEffect(() => () => reportFileSessionAgentOpen(null), [])

  const load = useCallback(async (): Promise<void> => {
    if (!window.vav?.knowledge) {
      setHost(null)
      return
    }
    const next = hostId
      ? await window.vav.knowledge.get(hostId)
      : await window.vav.knowledge.getForConversation(conversationId)
    setHost(next)
  }, [conversationId, hostId])

  useEffect(() => {
    void load()
    return window.vav.knowledge?.onChanged(() => {
      void load()
    })
  }, [load])

  useEffect(() => {
    if (!hideAgent) return
    syncWorkspaceAgentFocusedPath(host?.storedPath ?? host?.sourcePath)
  }, [hideAgent, host?.storedPath, host?.sourcePath])

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const startX = event.clientX
    const startW = agentWidthRef.current
    startCapturedPointerDrag(event, {
      cursor: 'col-resize',
      classTarget: rootRef.current,
      className: 'is-col-resizing',
      onMove: (ev) => {
        const total = rootRef.current?.clientWidth ?? 800
        const max = Math.max(AGENT_MIN, Math.floor(total * 0.7))
        const next = Math.min(max, Math.max(AGENT_MIN, startW - (ev.clientX - startX)))
        setAgentWidth(next)
      },
      onUp: () => {
        try {
          localStorage.setItem(AGENT_WIDTH_KEY, String(agentWidthRef.current))
        } catch {
          // ignore
        }
      }
    })
  }, [])

  if (!host) {
    return (
      <EmptyState title={t('knowledge.missingTitle')} description={t('knowledge.missingDesc')} />
    )
  }

  return (
    <div className="workspace-view file-session-view" ref={rootRef} data-testid="knowledge-workspace">
      <section className="workspace-view-preview file-session-preview">
        <header
          className={`file-viewer-header titlebar-drag${shellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="file-viewer-lead">
            {shellLeading ? (
              <div className="file-viewer-shell-leading titlebar-no-drag">{shellLeading}</div>
            ) : null}
            <span className="file-viewer-name" title={host.title}>
              {host.title}
            </span>
          </div>
          <span className="spacer" />
          {host.kind === 'document' ? (
            <div className="file-viewer-actions titlebar-no-drag">
              <Button
                icon={<RefreshCw size={13} />}
                variant="ghost"
                size="sm"
                title={t('knowledge.reindex')}
                onClick={() => void window.vav.knowledge.refresh(host.id)}
              />
            </div>
          ) : null}
        </header>
        {host.kind === 'note' ? (
          <KnowledgeNoteEditor hostId={host.id} />
        ) : (
          <div className="knowledge-document-body" data-testid="knowledge-document">
            <FileText size={28} aria-hidden />
            <p className="knowledge-document-title">{host.title}</p>
            <p className="muted">
              {host.sourcePath ? basename(host.sourcePath) : t('knowledge.document')}
              {host.chunkCount > 0 ? ` · ${t('knowledge.chunkCount', { count: host.chunkCount })}` : ''}
            </p>
            <p className="form-hint">{t('knowledge.documentHint')}</p>
          </div>
        )}
      </section>
      {hideAgent ? null : (
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
            onPointerDown={startResize}
            onDoubleClick={() => setAgentOpen((value) => !value)}
          />
          <SessionDetail variant="preview-edit" />
        </div>
      </aside>
      )}
    </div>
  )
}
