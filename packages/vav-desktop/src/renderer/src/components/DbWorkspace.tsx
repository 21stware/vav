import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { DbConnection } from '@shared/dbConnection'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { useT } from '../i18n/useT'
import { Button, EmptyState } from './ui'
import { SessionDetail } from './SessionDetail'
import { SqliteView } from './SqliteView'
import { DbConnectEditor } from './DbConnectEditor'

export function DbWorkspace({ conversationId }: { conversationId: string }): React.JSX.Element {
  const t = useT()
  const [connection, setConnection] = useState<DbConnection | null>(null)
  const [schema, setSchema] = useState<SqliteDatabaseInfo | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [opened, setOpened] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const openedRef = useRef(false)

  useEffect(() => {
    openedRef.current = false
    setOpened(false)
    setHydrated(false)
    setEditing(false)
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
    const inspected = await window.vav.db.schema(next.id)
    if ('error' in inspected) {
      setSchema(null)
      setSchemaError(inspected.error)
      return
    }
    setSchemaError(null)
    setSchema(inspected)
  }, [conversationId, hydrated])

  useEffect(() => {
    void load()
    return window.vav.db?.onChanged(() => {
      void load()
    })
  }, [load])

  if (!opened || editing || !connection) {
    return (
      <DbConnectEditor
        conversationId={conversationId}
        onConnected={() => {
          openedRef.current = true
          setOpened(true)
          setEditing(false)
          void load()
        }}
      />
    )
  }

  return (
    <div className="workspace-view preview-right" data-testid="db-workspace">
      <section className="workspace-view-agent">
        <SessionDetail variant="workspace" />
      </section>
      <aside className="workspace-view-preview" data-testid="db-browser">
        <div className="workspace-view-preview-inner" style={{ width: '100%' }}>
          <div className="workspace-preview-empty-bar" style={{ padding: '8px 12px' }}>
            <span className="muted tiny">
              {connection.host}
              {connection.database ? ` / ${connection.database}` : ''}
            </span>
            <span className="spacer" />
            <Button
              icon={<Pencil size={13} />}
              variant="ghost"
              size="sm"
              title={t('db.editConnection')}
              testId="db-edit-connection"
              onClick={() => setEditing(true)}
            />
          </div>
          {schemaError ? (
            <EmptyState title={t('db.schemaFailed')} description={schemaError} />
          ) : schema ? (
            <SqliteView
              path={`db:${connection.id}`}
              info={schema}
              selecting={false}
              selectedIds={[]}
              onSelect={() => undefined}
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
      </aside>
    </div>
  )
}
