import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { DbConnection } from '@shared/dbConnection'
import { stableDatabaseTitle } from '../lib/grouping'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { FILE_SESSION_AGENT_MIN_WIDTH } from '@shared/shellMinSize'
import { useT } from '../i18n/useT'
import { applyBlockPick, selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { reportFileSessionAgentOpen } from '../lib/useWindowMinSize'
import { useSessionStore } from '../state/sessionStore'
import { Button, EmptyState } from './ui'
import { SessionDetail } from './SessionDetail'
import { ShellLeadingControls } from './ShellLeadingControls'
import { SqliteView } from './SqliteView'
import { DbConnectEditor } from './DbConnectEditor'

const AGENT_MIN = FILE_SESSION_AGENT_MIN_WIDTH
const AGENT_DEFAULT = 380
const AGENT_WIDTH_KEY = 'vav.db-session-agent-width'

function loadAgentWidth(): number {
  try {
    const n = Number(localStorage.getItem(AGENT_WIDTH_KEY))
    if (Number.isFinite(n) && n >= AGENT_MIN) return Math.round(n)
  } catch {
    // ignore
  }
  return AGENT_DEFAULT
}

export function DbWorkspace({ conversationId }: { conversationId: string }): React.JSX.Element {
  const t = useT()
  const activeDbTable = useSessionStore((s) => s.activeDbTable)
  const setActiveDbTable = useSessionStore((s) => s.setActiveDbTable)
  const setDbSchema = useSessionStore((s) => s.setDbSchema)
  const commentTick = useSessionStore((s) => s.commentCards[conversationId]?.length ?? 0)
  void commentTick
  const [connection, setConnection] = useState<DbConnection | null>(null)
  const [schema, setSchema] = useState<SqliteDatabaseInfo | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [agentWidth, setAgentWidth] = useState(loadAgentWidth)
  const [agentOpen, setAgentOpen] = useState(true)
  const openedRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth

  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)
  const shellLeading = showShellLeading ? <ShellLeadingControls /> : null

  useEffect(() => {
    reportFileSessionAgentOpen(agentOpen, agentWidth)
  }, [agentOpen, agentWidth])
  useEffect(() => () => reportFileSessionAgentOpen(null), [])

  useEffect(() => {
    openedRef.current = false
    setOpened(false)
    setHydrated(false)
    setSchema(null)
    setSchemaError(null)
  }, [conversationId])

  const load = useCallback(async (): Promise<void> => {
    if (!window.vav?.db?.getForConversation) {
      setConnection(null)
      return
    }
    const next = await window.vav.db.getForConversation(conversationId)
    setConnection(next)
    const ready = next?.lastStatus === 'ok'
    if (!hydrated) {
      openedRef.current = ready
      setOpened(ready)
      setHydrated(true)
    }
    if (!next || !ready || !openedRef.current) {
      setSchema(null)
      setSchemaError(null)
      return
    }
    try {
      const inspected = await window.vav.db.schema(next.id)
      setDbSchema(next.id, inspected)
      if ('error' in inspected) {
        setSchema(null)
        setSchemaError(inspected.error)
        return
      }
      setSchemaError(null)
      setSchema(inspected)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDbSchema(next.id, { error: message })
      setSchema(null)
      setSchemaError(message)
    }
  }, [conversationId, hydrated, setDbSchema])

  useEffect(() => {
    void load()
    return window.vav.db?.onChanged(() => {
      void load()
    })
  }, [load])

  const startResize = useCallback((event: React.MouseEvent): void => {
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
  }, [])

  if (!opened || !connection) {
    return (
      <DbConnectEditor
        conversationId={conversationId}
        onConnected={() => {
          openedRef.current = true
          setOpened(true)
          void load()
        }}
      />
    )
  }

  const connectionLabel = stableDatabaseTitle(connection, t('db.untitled'))
  const sourcePath = activeDbTable ? `${connectionLabel}/${activeDbTable}` : connectionLabel
  const selectedIds = selectedBlockIdsForPath(conversationId, sourcePath)
  const tableInfo =
    schema && activeDbTable
      ? {
          tables: schema.tables.filter((table) => table.name === activeDbTable)
        }
      : schema
  const showTable = !!activeDbTable && !!tableInfo && tableInfo.tables.length > 0
  const showConfig = !activeDbTable
  // Bridge only mode changes (connect ↔ table ↔ error ↔ loading); keying on the
  // table name too would re-fade the data grid on every table switch.
  const swapMode = schemaError ? 'error' : showConfig ? 'config' : showTable ? 'table' : 'loading'

  return (
    <div className="workspace-view file-session-view" ref={rootRef} data-testid="db-workspace">
      <section className="workspace-view-preview file-session-preview" data-testid="db-browser">
        <header
          className={`file-viewer-header db-workspace-header${shellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="file-viewer-lead">
            {shellLeading ? (
              <div className="file-viewer-shell-leading">{shellLeading}</div>
            ) : null}
            <span
              className="file-viewer-name"
              title={activeDbTable ? `${connectionLabel} / ${activeDbTable}` : connectionLabel}
            >
              {connectionLabel}
              {activeDbTable ? (
                <span className="db-workspace-header-table"> / {activeDbTable}</span>
              ) : null}
            </span>
          </div>
          <span className="spacer" />
          <div className="file-viewer-actions">
            {showTable ? (
              <Button
                icon={<Pencil size={13} />}
                variant="ghost"
                size="sm"
                title={t('db.editConnection')}
                testId="db-edit-connection"
                onClick={() => setActiveDbTable(null)}
              />
            ) : null}
          </div>
        </header>
        <div className="db-preview-swap" data-testid="db-preview-swap" key={swapMode}>
          {schemaError ? (
            <EmptyState title={t('db.schemaFailed')} description={schemaError} />
          ) : showConfig ? (
            <DbConnectEditor
              conversationId={conversationId}
              embedded
              onConnected={() => {
                openedRef.current = true
                setOpened(true)
                void load()
              }}
            />
          ) : showTable && tableInfo ? (
            <SqliteView
              key={`${connection.id}:${activeDbTable}`}
              path={sourcePath}
              info={tableInfo}
              hideNav
              activeTable={activeDbTable}
              selecting
              selectedIds={selectedIds}
              onSelect={(_id, _event, hint) => {
                if (!hint) return
                applyBlockPick({
                  conversationId,
                  sourcePath,
                  badge: connectionLabel,
                  block: {
                    ...hint,
                    label: hint.label?.startsWith(activeDbTable)
                      ? hint.label
                      : `${activeDbTable} · ${hint.label || hint.kind}`
                  }
                })
              }}
              query={(table, offset, limit) =>
                window.vav.db.queryTable(connection.id, table, offset, limit)
              }
            />
          ) : (
            <div className="muted" style={{ padding: 24 }}>
              {t('common.loading')}
            </div>
          )}
        </div>
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
            onDoubleClick={() => setAgentOpen((value) => !value)}
          />
          <SessionDetail variant="workspace" />
        </div>
      </aside>
    </div>
  )
}
