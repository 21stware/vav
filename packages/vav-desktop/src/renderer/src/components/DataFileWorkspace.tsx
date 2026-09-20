import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { FILE_SESSION_AGENT_MIN_WIDTH } from '@shared/shellMinSize'
import { useT } from '../i18n/useT'
import { applyBlockPick, selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { startCapturedPointerDrag } from '../lib/capturedPointerDrag'
import { reportFileSessionAgentOpen } from '../lib/useWindowMinSize'
import { basename } from '../lib/path'
import { useSessionStore } from '../state/sessionStore'
import { EmptyState } from './ui'
import { SessionDetail } from './SessionDetail'
import { ShellLeadingControls } from './ShellLeadingControls'
import { SqliteView } from './SqliteView'

const AGENT_MIN = FILE_SESSION_AGENT_MIN_WIDTH
const AGENT_DEFAULT = 380
const AGENT_WIDTH_KEY = 'vav.data-file-agent-width'

function loadAgentWidth(): number {
  try {
    const n = Number(localStorage.getItem(AGENT_WIDTH_KEY))
    if (Number.isFinite(n) && n >= AGENT_MIN) return Math.round(n)
  } catch {
    // ignore
  }
  return AGENT_DEFAULT
}

export function DataFileWorkspace({
  conversationId,
  path,
  hideAgent = false
}: {
  conversationId: string
  path: string
  hideAgent?: boolean
}): React.JSX.Element {
  const t = useT()
  const activeDbTable = useSessionStore((s) => s.activeDbTable)
  const setActiveDbTable = useSessionStore((s) => s.setActiveDbTable)
  const [schema, setSchema] = useState<SqliteDatabaseInfo | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [agentWidth, setAgentWidth] = useState(loadAgentWidth)
  const [agentOpen, setAgentOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const agentWidthRef = useRef(agentWidth)
  agentWidthRef.current = agentWidth

  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !hideAgent && !(sidebarVisible && !sidebarFloating)
  const shellLeading = showShellLeading ? <ShellLeadingControls /> : null
  const label = basename(path) || path

  useEffect(() => {
    reportFileSessionAgentOpen(agentOpen, agentWidth)
  }, [agentOpen, agentWidth])
  useEffect(() => () => reportFileSessionAgentOpen(null), [])

  const load = useCallback(async (): Promise<void> => {
    if (!window.vav?.db?.fileSchema) return
    try {
      const inspected = await window.vav.db.fileSchema(path)
      if ('error' in inspected) {
        setSchema(null)
        setSchemaError(inspected.error)
        return
      }
      setSchemaError(null)
      setSchema(inspected)
    } catch (err) {
      setSchema(null)
      setSchemaError(err instanceof Error ? err.message : String(err))
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!schema?.tables.length) return
    if (activeDbTable && schema.tables.some((table) => table.name === activeDbTable)) return
    setActiveDbTable(schema.tables[0]!.name)
  }, [schema, activeDbTable, setActiveDbTable])

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

  const sourcePath = activeDbTable ? `${path}/${activeDbTable}` : path
  const selectedIds = selectedBlockIdsForPath(conversationId, sourcePath)

  return (
    <div className="workspace-view file-session-view" ref={rootRef} data-testid="data-file-workspace">
      <section className="workspace-view-preview file-session-preview">
        <header
          className={`file-viewer-header db-workspace-header titlebar-drag${shellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="file-viewer-lead">
            {shellLeading ? (
              <div className="file-viewer-shell-leading titlebar-no-drag">{shellLeading}</div>
            ) : null}
            <span className="file-viewer-name" title={path}>
              {label}
              {activeDbTable ? (
                <span className="db-workspace-header-table"> / {activeDbTable}</span>
              ) : null}
            </span>
          </div>
        </header>
        {schemaError ? (
          <EmptyState title={t('data.schemaFailed')} description={schemaError} />
        ) : schema?.tables.length ? (
          <SqliteView
            key={path}
            path={path}
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
                badge: label,
                block: {
                  ...hint,
                  label: hint.label?.startsWith(table)
                    ? hint.label
                    : `${table} · ${hint.label || hint.kind}`
                }
              })
            }}
            query={(table, offset, limit) =>
              window.vav.db.fileQuery(
                path,
                `SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ${limit} OFFSET ${offset}`
              )
            }
          />
        ) : schema ? (
          <EmptyState title={t('db.noTables')} description={t('data.fileEmpty')} />
        ) : (
          <div className="muted" style={{ padding: 24 }}>
            {t('common.loading')}
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
