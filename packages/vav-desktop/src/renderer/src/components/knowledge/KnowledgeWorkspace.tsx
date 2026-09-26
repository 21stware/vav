import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import type { KnowledgeHost } from '@shared/knowledge'
import { FILE_SESSION_AGENT_MIN_WIDTH } from '@shared/shellMinSize'
import { useT } from '../../i18n/useT'
import { useShowShellLeading } from '../../lib/sidebarLayout'
import { startCapturedPointerDrag } from '../../lib/capturedPointerDrag'
import { reportFileSessionAgentOpen } from '../../lib/useWindowMinSize'
import { syncWorkspaceAgentFocusedPath } from '../../lib/workspaceAgentContext'
import { warmSessionDetail } from '../../lib/apps/warmAppViews'
import { useSessionStore } from '../../state/sessionStore'
import { Button, EmptyState } from '../ui'
import { countFact, ObjectFacts, timeFact } from '../ObjectFacts'
import { ShellLeadingControls } from '../ShellLeadingControls'
import { KnowledgeNoteEditor } from './KnowledgeNoteEditor'
import { useKnowledgeHost } from './useKnowledgeHost'
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

export { useKnowledgeHost } from './useKnowledgeHost'

export function KnowledgeHostActions({ host }: { host: KnowledgeHost }): React.JSX.Element | null {
  const t = useT()
  if (host.kind === 'note') return null
  return (
    <Button
      icon={<RefreshCw size={13} />}
      variant="ghost"
      size="sm"
      title={t('knowledge.reindex')}
      onClick={() => void window.vav.knowledge.refresh(host.id)}
    />
  )
}

export function KnowledgeWorkspace({
  conversationId,
  hideAgent = false
}: {
  conversationId: string
  hideAgent?: boolean
}): React.JSX.Element {
  const t = useT()
  const host = useKnowledgeHost(conversationId)
  const [agentWidth, setAgentWidth] = useState(loadAgentWidth)
  const [agentOpen, setAgentOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth

  const shellLeadingNeeded = useShowShellLeading()
  const showShellLeading = !hideAgent && shellLeadingNeeded
  const shellLeading = showShellLeading ? <ShellLeadingControls /> : null
  const SessionDetail = warmSessionDetail.use(!hideAgent)

  useEffect(() => {
    reportFileSessionAgentOpen(agentOpen, agentWidth)
  }, [agentOpen, agentWidth])
  useEffect(() => () => reportFileSessionAgentOpen(null), [])

  const applicationsVisible = useSessionStore((s) => s.applicationsVisible)
  useEffect(() => {
    if (!hideAgent) return
    syncWorkspaceAgentFocusedPath(host?.storedPath ?? host?.sourcePath)
  }, [hideAgent, applicationsVisible, host?.storedPath, host?.sourcePath])

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
      <div className="workspace-view file-session-view" data-testid="knowledge-workspace">
        <section className="workspace-view-preview file-session-preview">
          <EmptyState title={t('knowledge.missingTitle')} description={t('knowledge.missingDesc')} />
        </section>
      </div>
    )
  }

  return (
    <div className="workspace-view file-session-view" ref={rootRef} data-testid="knowledge-workspace">
      <section className="workspace-view-preview file-session-preview">
        {hideAgent ? null : (
        <header
          className={`file-viewer-header titlebar-drag${shellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="file-viewer-lead">
            {shellLeading ? (
              <div className="file-viewer-shell-leading titlebar-no-drag">{shellLeading}</div>
            ) : null}
            {host.kind === 'note' ? null : (
              <span className="file-viewer-name" title={host.title}>
                {host.title}
              </span>
            )}
          </div>
          <span className="spacer" />
          <div className="file-viewer-actions titlebar-no-drag">
            <KnowledgeHostActions host={host} />
          </div>
        </header>
        )}
        {host.kind === 'note' ? (
          <KnowledgeNoteEditor
            hostId={host.id}
            title={host.title}
            showTitle
            createdAt={host.createdAt}
            updatedAt={host.updatedAt}
          />
        ) : (
          <>
            <div className="knowledge-document-body" data-testid="knowledge-document">
              <FileText size={28} aria-hidden />
              <p className="knowledge-document-title">{host.title}</p>
              <p className="muted">
                {host.sourcePath ? basename(host.sourcePath) : t('knowledge.document')}
              </p>
              <p className="form-hint">{t('knowledge.documentHint')}</p>
            </div>
            <ObjectFacts
              items={[
                timeFact('created', t('object.fact.created'), host.createdAt),
                timeFact('updated', t('object.fact.updated'), host.updatedAt),
                countFact('chunks', t('object.fact.chunks'), host.chunkCount)
              ]}
            />
          </>
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
        >
          <div
            className="workspace-col-resizer workspace-col-resizer-start"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizeAgentPanel')}
            onPointerDown={startResize}
            onDoubleClick={() => setAgentOpen((value) => !value)}
          />
          {SessionDetail ? <SessionDetail variant="preview-edit" /> : null}
        </div>
      </aside>
      )}
    </div>
  )
}
