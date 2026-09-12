import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pencil } from 'lucide-react'
import { isDbAuthError, type DbConnection } from '@shared/dbConnection'
import { stableDatabaseTitle } from '../lib/grouping'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { FILE_SESSION_AGENT_MIN_WIDTH } from '@shared/shellMinSize'
import { useT } from '../i18n/useT'
import { applyBlockPick, selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { startCapturedPointerDrag } from '../lib/capturedPointerDrag'
import { reportFileSessionAgentOpen } from '../lib/useWindowMinSize'
import { useSessionStore } from '../state/sessionStore'
import { useDbSessionHistory } from '../lib/useBoundSessionHistory'
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
  const conversationDbId = useSessionStore(
    (s) => s.conversations.find((row) => row.id === conversationId)?.dbConnectionId ?? null
  )
  const [connection, setConnection] = useState<DbConnection | null>(null)
  const dbHistory = useDbSessionHistory(connection?.id ?? conversationDbId, conversationId)
  const [schema, setSchema] = useState<SqliteDatabaseInfo | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [editingConnection, setEditingConnection] = useState(false)
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
    setEditingConnection(false)
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
        if (isDbAuthError(inspected.error)) setEditingConnection(true)
        return
      }
      setSchemaError(null)
      setSchema(inspected)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDbSchema(next.id, { error: message })
      setSchema(null)
      setSchemaError(message)
      if (isDbAuthError(message)) setEditingConnection(true)
    }
  }, [conversationId, hydrated, setDbSchema])

  useEffect(() => {
    void load()
    const offDb = window.vav.db?.onChanged(() => {
      void load()
    })
    const offTurn = window.vav.agent?.onEvent((event) => {
      if (event.conversationId !== conversationId) return
      if (event.type === 'end' || event.type === 'fs-changed') void load()
    })
    return () => {
      offDb?.()
      offTurn?.()
    }
  }, [conversationId, load])

  useEffect(() => {
    if (editingConnection || !schema?.tables.length) return
    if (activeDbTable && schema.tables.some((table) => table.name === activeDbTable)) return
    setActiveDbTable(schema.tables[0]!.name)
  }, [schema, activeDbTable, editingConnection, setActiveDbTable])

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

  if (!opened || !connection) {
    return (
      <DbConnectEditor
        conversationId={conversationId}
        initialConnection={connection}
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
  const showConfig = editingConnection
  const showTable = !showConfig && !!schema && schema.tables.length > 0
  const showEmpty = !showConfig && !!schema && schema.tables.length === 0
  // Bridge only mode changes (connect ↔ table ↔ error ↔ empty ↔ loading); keying
  // on the table name too would re-fade the data grid on every table switch.
  const swapMode = schemaError
    ? 'error'
    : showConfig
      ? 'config'
      : showTable
        ? 'table'
        : showEmpty
          ? 'empty'
          : 'loading'

  return (
    <div className="workspace-view file-session-view" ref={rootRef} data-testid="db-workspace">
      <section className="workspace-view-preview file-session-preview" data-testid="db-browser">
        <header
          className={`file-viewer-header db-workspace-header titlebar-drag${shellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="file-viewer-lead">
            {shellLeading ? (
              <div className="file-viewer-shell-leading titlebar-no-drag">{shellLeading}</div>
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
          <div className="file-viewer-actions titlebar-no-drag">
            <Button
              icon={<Pencil size={13} />}
              variant="ghost"
              size="sm"
              title={t('db.editConnection')}
              testId="db-edit-connection"
              pressed={editingConnection}
              onClick={() => setEditingConnection((value) => !value)}
            />
          </div>
        </header>
        <div className="db-preview-swap" data-testid="db-preview-swap" key={swapMode}>
          {schemaError && !showConfig ? (
            <EmptyState
              title={t('db.schemaFailed')}
              description={isDbAuthError(schemaError) ? t('db.passwordRequired') : schemaError}
            />
          ) : showConfig ? (
            <DbConnectEditor
              conversationId={conversationId}
              initialConnection={connection}
              embedded
              notice={
                schemaError && isDbAuthError(schemaError) ? t('db.passwordRequired') : null
              }
              onConnected={() => {
                openedRef.current = true
                setOpened(true)
                setEditingConnection(false)
                void load()
              }}
            />
          ) : showTable && schema ? (
            <SqliteView
              key={connection.id}
              path={connection.id}
              info={schema}
              activeTable={activeDbTable ?? schema.tables[0]?.name}
              onActiveTableChange={setActiveDbTable}
              navSide
              selecting
              selectedIds={selectedIds}
              onSelect={(_id, _event, hint) => {
                if (!hint) return
                const table = activeDbTable || schema.tables[0]?.name || ''
                applyBlockPick({
                  conversationId,
                  sourcePath,
                  badge: connectionLabel,
                  block: {
                    ...hint,
                    label: hint.label?.startsWith(table)
                      ? hint.label
                      : `${table} · ${hint.label || hint.kind}`
                  }
                })
              }}
              query={(table, offset, limit) =>
                window.vav.db.queryTable(connection.id, table, offset, limit)
              }
            />
          ) : showEmpty ? (
            <EmptyState title={t('db.noTables')} description={t('db.selectTable')} />
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
            onPointerDown={startResize}
            onDoubleClick={() => setAgentOpen((value) => !value)}
          />
          <SessionDetail variant="preview-edit" fileSessionChrome={dbHistory} />
        </div>
      </aside>
    </div>
  )
}
