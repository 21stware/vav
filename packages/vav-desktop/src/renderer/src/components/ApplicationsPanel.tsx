import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  BookPlus,
  Database,
  FilePlus2,
  FileText,
  FolderOpen,
  Laptop,
  MonitorSmartphone,
  Plus,
  StickyNote
} from 'lucide-react'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import {
  KNOWLEDGE_ALL_NOTES_ID,
  knowledgeNotePreview,
  type KnowledgeFolder,
  type KnowledgeHost
} from '@shared/knowledge'
import { isPlaceholderDbTitle } from '@shared/dbConnection'
import { isDataFilePath } from '@shared/dataFile'
import {
  APP_FOLDER_ALL_ID,
  appFolderDragType,
  coerceAppLibraries,
  readAppFolderDrag
} from '@shared/appFolders'
import { isDbSession, isKnowledgeSession, isTimerDefinition } from '@shared/sessionKind'
import { isLocalMachine, listedServices, normalizeMachineId } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { absoluteTime, relativeTime } from '../lib/format'
import { basename } from '../lib/path'
import { countWritingUnits } from '../lib/writingStats'
import { openPickedFileSessions } from '../lib/openFileSession'
import { conversationForAppMode } from '../lib/appColumnObject'
import { appColumnSurface, appObjectListKey, dataRowsNeedingSchema, knowledgeNoteIdsForPreview } from '../lib/apps/appColumnLoad'
import {
  prefetchAppModeSurfaces,
  warmDataFileWorkspace,
  warmDbWorkspace,
  warmFileSessionView,
  warmKnowledgeWorkspace,
  warmScheduleEditor,
  warmSessionPreviewPane,
  warmTimerJobsPanel
} from '../lib/apps/warmAppViews'
import type { ApplicationsMode } from '../state/sessionTypes'
import { AppFolderRail } from './AppFolderRail'
import {
  appFolderCounts,
  assignCreatedAppObject,
  createAppFolder,
  filedAppFolderId,
  moveAppFolderObjects,
  removeAppFolder,
  renameAppFolder,
  setAppFolderSelectedId,
  useAppFolderSelectedId
} from '../lib/appFolderLibrary'
import { FileRecentsPanel } from './FileRecentsPanel'
import { KNOWLEDGE_DRAG_TYPE, KnowledgeFolderRail } from './knowledge/KnowledgeFolderRail'
import { setKnowledgeFolderId, useKnowledgeFolderId } from '../lib/knowledgeFolderSelection'
import { usePreviewFilePath } from './usePreviewFilePath'
import { AppModeTabs } from './AppModeTabs'
import { SidebarServiceBar } from './sidebar/SidebarServiceBar'
import { AppColumnFocusSync } from './AppColumnFocusSync'
import {
  appObjectContextTargets,
  appObjectRowClassName,
  appObjectSelectionMods,
  applyAppObjectList
} from '../lib/appObjectList'
import { appObjectPointerHandlers, menuPoint, useAppObjectConversationMenu } from '../lib/appObjectRow'
import { nextConversationSelection } from '../state/sessionListMerge'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import {
  AppObjectListToolbar,
  useAppObjectList,
  useAppObjectListKeys,
  useAppObjectListSelection
} from './AppObjectListToolbar'
import { RenameField } from './sidebar/RenameField'
import { AppEmptyState } from './AppEmptyState'
import { formatFactCount, ObjectListLine } from './ObjectFacts'
import { Button, EmptyState } from './ui'
import {
  getAppColumnPlugin,
  registerAppColumnPlugin,
  type AppColumnDetailProps,
  type AppColumnListProps
} from '../lib/apps/registry'

export function ApplicationsPanel(): React.JSX.Element {
  const t = useT()
  const mode = useSessionStore((s) => s.applicationsMode)
  const setFilePreviewHost = useSessionStore((s) => s.setFilePreviewHost)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const conversation = useSessionStore((s) => conversationForAppMode(s, s.applicationsMode))
  const previewPath = usePreviewFilePath(conversation?.workingDirectory ?? null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const detailOpen = useSessionStore((s) => s.applicationsDetailOpen)
  const setApplicationsDetailOpen = useSessionStore((s) => s.setApplicationsDetailOpen)
  const [storagePath, setStoragePath] = useState<string | null>(null)

  useEffect(() => {
    setFilePreviewHost(true)
    return () => setFilePreviewHost(false)
  }, [setFilePreviewHost])

  useEffect(() => {
    prefetchAppModeSurfaces(mode)
  }, [mode])

  const plugin = getAppColumnPlugin(mode)
  const hasDetail = plugin
    ? plugin.hasDetail({ conversation, filePreviewOpen })
    : mode === 'devices' && deviceId !== null

  useEffect(() => {
    if (mode !== 'devices') setDeviceId(null)
  }, [mode])

  const openDetail = (): void => setApplicationsDetailOpen(true)

  const showingDetail = detailOpen && hasDetail
  const trailing = showingDetail ? (
    mode === 'devices' && deviceId ? <DevicesDetailActions selectedId={deviceId} /> : null
  ) : plugin ? (
    <plugin.Actions onOpenDetail={openDetail} />
  ) : (
    <SidebarServiceBar variant="nav" testId="devices-menu" label={t('sidebar.switchService')} />
  )

  return (
    <aside
      className="applications-panel app-panel"
      data-testid="applications-panel"
      data-app={mode}
      data-pane={showingDetail ? 'detail' : 'list'}
    >
      <AppColumnFocusSync
        mode={mode}
        conversationId={conversation?.id ?? null}
        previewPath={previewPath}
        storagePath={storagePath}
        showingDetail={showingDetail}
      />
      <AppModeTabs trailing={trailing} canBack={showingDetail} />
      <div className="applications-main">
        <AppModePane
          modeId={mode}
          filePreviewOpen={filePreviewOpen}
          previewPath={previewPath}
          onStoragePath={setStoragePath}
          onOpenDetail={openDetail}
          deviceId={deviceId}
          onSelectDevice={setDeviceId}
          onOpenDevice={(id) => {
            setDeviceId(id)
            openDetail()
          }}
        />
      </div>
    </aside>
  )
}

function AppSurfaceLoading(): React.JSX.Element {
  const t = useT()
  return <div className="muted tiny" style={{ padding: 16 }}>{t('common.loading')}</div>
}

function AppModePane({
  modeId,
  filePreviewOpen,
  previewPath,
  onStoragePath,
  onOpenDetail,
  deviceId,
  onSelectDevice,
  onOpenDevice
}: {
  modeId: ApplicationsMode
  filePreviewOpen: boolean
  previewPath: string | null
  onStoragePath: (path: string | null) => void
  onOpenDetail: () => void
  deviceId: string | null
  onSelectDevice: (id: string | null) => void
  onOpenDevice: (id: string) => void
}): React.JSX.Element {
  const plugin = getAppColumnPlugin(modeId)
  const conversation = useSessionStore((s) => conversationForAppMode(s, modeId))
  const detailOpen = useSessionStore((s) => s.applicationsDetailOpen)
  const hasDetail = plugin
    ? plugin.hasDetail({ conversation, filePreviewOpen: modeId === 'storage' && filePreviewOpen })
    : modeId === 'devices' && deviceId !== null
  const showingDetail = detailOpen && hasDetail
  const surface = appColumnSurface(showingDetail)

  return (
    <div
      className="applications-mode-pane"
      data-app={modeId}
      data-active="true"
    >
      <div
        className="applications-split"
        data-has-detail={hasDetail ? 'true' : 'false'}
        data-pane={surface}
      >
        {surface === 'list' ? (
          <div className="applications-object-list" data-testid="applications-object-list">
            {plugin ? <plugin.List onOpenDetail={onOpenDetail} /> : null}
            {modeId === 'devices' ? (
              <DevicesObjectList
                selectedId={deviceId}
                onSelect={onSelectDevice}
                onOpen={onOpenDevice}
              />
            ) : null}
          </div>
        ) : (
          <div className="applications-object-detail" data-testid="applications-object-detail">
            {plugin ? (
              <plugin.Detail
                conversation={conversation}
                previewPath={previewPath}
                filePreviewOpen={filePreviewOpen}
                onStoragePath={onStoragePath}
              />
            ) : null}
            {modeId === 'devices' && deviceId !== null ? (
              <DevicesObjectDetail selectedId={deviceId} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduledActions({ onOpenDetail }: AppColumnListProps): React.JSX.Element {
  const t = useT()
  const createScheduledConversation = useSessionStore((s) => s.createScheduledConversation)
  return (
    <Button
      variant="ghost"
      size="sm"
      testId="sidebar-create-scheduled"
      icon={<Plus size={14} strokeWidth={2} aria-hidden />}
      title={t('timer.new')}
      label={t('timer.new')}
      onClick={() => {
        void createScheduledConversation().then((id) => {
          assignCreatedAppObject('scheduled', id)
          onOpenDetail()
        })
      }}
    />
  )
}

function StorageActions({ onOpenDetail }: AppColumnListProps): React.JSX.Element | null {
  const t = useT()
  const filesSource = useSessionStore((s) => s.filesSource)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  if (filesSource !== 'recent' || !isLocalMachine(windowMachineId)) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      testId="open-a-file"
      icon={<FolderOpen size={14} strokeWidth={2} aria-hidden />}
      title={t('sidebar.openAFile')}
      label={t('sidebar.openAFile')}
      onClick={() => {
        void openPickedFileSessions().then((opened) => {
          if (opened) onOpenDetail()
        })
      }}
    />
  )
}

function DataActions({ onOpenDetail }: AppColumnListProps): React.JSX.Element {
  const t = useT()
  const createDbConversation = useSessionStore((s) => s.createDbConversation)
  const createDataFromFile = useSessionStore((s) => s.createDataFromFile)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        testId="empty-create-db"
        icon={<Plus size={14} strokeWidth={2} aria-hidden />}
        title={t('db.new')}
        label={t('db.new')}
        onClick={() => {
          void createDbConversation().then((id) => {
            assignCreatedAppObject('data', id)
            onOpenDetail()
          })
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        testId="empty-add-data-file"
        icon={<FilePlus2 size={14} strokeWidth={2} aria-hidden />}
        title={t('data.addFile')}
        label={t('data.addFile')}
        onClick={() => {
          void (async () => {
            const picked = await window.vav.files?.pickAttachments()
            if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
            assignCreatedAppObject('data', await createDataFromFile(picked.paths[0]))
            onOpenDetail()
          })()
        }}
      />
    </>
  )
}

function KnowledgeActions({ onOpenDetail }: AppColumnListProps): React.JSX.Element {
  const t = useT()
  const createKnowledgeNote = useSessionStore((s) => s.createKnowledgeNote)
  const importKnowledgeDocument = useSessionStore((s) => s.importKnowledgeDocument)
  const knowledgeFolderId = useKnowledgeFolderId()
  const filedFolder = knowledgeFolderId === KNOWLEDGE_ALL_NOTES_ID ? null : knowledgeFolderId
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        testId="empty-create-note"
        icon={<StickyNote size={14} strokeWidth={2} aria-hidden />}
        title={t('knowledge.newNote')}
        label={t('knowledge.newNote')}
        onClick={() => {
          void createKnowledgeNote(filedFolder).then(onOpenDetail)
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        testId="empty-import-knowledge"
        icon={<BookPlus size={14} strokeWidth={2} aria-hidden />}
        title={t('knowledge.importDocument')}
        label={t('knowledge.importDocument')}
        onClick={() => {
          void (async () => {
            const picked = await window.vav.files?.pickAttachments()
            if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
            await importKnowledgeDocument(picked.paths[0], filedFolder)
            onOpenDetail()
          })()
        }}
      />
    </>
  )
}

function StorageList({ onOpenDetail }: AppColumnListProps): React.JSX.Element {
  return <FileRecentsPanel embedded onOpenDetail={onOpenDetail} />
}

function DataList({ onOpenDetail: _onOpenDetail }: AppColumnListProps): React.JSX.Element {
  return <DataObjectList />
}

function KnowledgeList({ onOpenDetail: _onOpenDetail }: AppColumnListProps): React.JSX.Element {
  return <KnowledgeObjectList />
}

function ScheduledDetail({ conversation }: AppColumnDetailProps): React.JSX.Element | null {
  const ScheduleEditor = warmScheduleEditor.use(!!(conversation && isTimerDefinition(conversation)))
  if (!conversation || !isTimerDefinition(conversation)) return null
  return ScheduleEditor ? <ScheduleEditor conversationId={conversation.id} /> : <AppSurfaceLoading />
}

function StorageDetail({
  conversation,
  previewPath,
  filePreviewOpen,
  onStoragePath
}: AppColumnDetailProps): React.JSX.Element | null {
  const FileSessionView = warmFileSessionView.use(!!conversation?.fileId)
  const SessionPreviewPane = warmSessionPreviewPane.use(!conversation?.fileId && filePreviewOpen)
  if (conversation?.fileId) {
    return FileSessionView ? (
      <FileSessionView
        conversationId={conversation.id}
        fileId={conversation.fileId}
        hideAgent
        onPathResolved={onStoragePath}
      />
    ) : (
      <AppSurfaceLoading />
    )
  }
  if (filePreviewOpen) {
    return SessionPreviewPane ? <SessionPreviewPane path={previewPath} /> : <AppSurfaceLoading />
  }
  return null
}

function DataDetail({ conversation }: AppColumnDetailProps): React.JSX.Element | null {
  const isFile = !!(conversation && isDbSession(conversation) && conversation.dataFilePath)
  const isLive = !!(conversation && isDbSession(conversation) && !conversation.dataFilePath)
  const DataFileWorkspace = warmDataFileWorkspace.use(isFile)
  const DbWorkspace = warmDbWorkspace.use(isLive)
  if (!conversation || !isDbSession(conversation)) return null
  if (conversation.dataFilePath) {
    return DataFileWorkspace ? (
      <DataFileWorkspace conversationId={conversation.id} path={conversation.dataFilePath} hideAgent />
    ) : (
      <AppSurfaceLoading />
    )
  }
  return DbWorkspace ? (
    <DbWorkspace conversationId={conversation.id} hideAgent />
  ) : (
    <AppSurfaceLoading />
  )
}

function KnowledgeDetail({ conversation }: AppColumnDetailProps): React.JSX.Element | null {
  const KnowledgeWorkspace = warmKnowledgeWorkspace.use(
    !!(conversation && isKnowledgeSession(conversation))
  )
  if (!conversation || !isKnowledgeSession(conversation)) return null
  return KnowledgeWorkspace ? (
    <KnowledgeWorkspace conversationId={conversation.id} hideAgent />
  ) : (
    <AppSurfaceLoading />
  )
}

registerAppColumnPlugin({
  id: 'knowledge',
  hasDetail: (ctx) => !!(ctx.conversation && isKnowledgeSession(ctx.conversation)),
  List: KnowledgeList,
  Detail: KnowledgeDetail,
  Actions: KnowledgeActions
})
registerAppColumnPlugin({
  id: 'data',
  hasDetail: (ctx) => !!(ctx.conversation && isDbSession(ctx.conversation)),
  List: DataList,
  Detail: DataDetail,
  Actions: DataActions
})
registerAppColumnPlugin({
  id: 'scheduled',
  hasDetail: (ctx) => !!(ctx.conversation && isTimerDefinition(ctx.conversation)),
  List: ScheduledObjectList,
  Detail: ScheduledDetail,
  Actions: ScheduledActions
})
registerAppColumnPlugin({
  id: 'storage',
  hasDetail: (ctx) => !!(ctx.conversation?.fileId || ctx.filePreviewOpen),
  List: StorageList,
  Detail: StorageDetail,
  Actions: StorageActions
})

function ScheduledObjectList({ onOpenDetail }: { onOpenDetail: () => void }): React.JSX.Element {
  const TimerJobsPanel = warmTimerJobsPanel.use(true)
  return (
    <div className="applications-home" data-testid="scheduled-home">
      {TimerJobsPanel ? (
        <TimerJobsPanel embedded onOpenDetail={onOpenDetail} />
      ) : (
        <AppSurfaceLoading />
      )}
    </div>
  )
}

function tableCounts(
  info: SqliteDatabaseInfo | { error: string } | null | undefined
): { tables: number; rows: number } | null {
  if (!info || 'error' in info) return null
  return {
    tables: info.tables.length,
    rows: info.tables.reduce((sum, table) => sum + table.rowCount, 0)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function loadAnalysisSchema(row: {
  dataFilePath?: string | null
}): Promise<SqliteDatabaseInfo | { error: string } | null> {
  if (!row.dataFilePath || !window.vav?.db?.fileSchema) return null
  try {
    return await withTimeout(window.vav.db.fileSchema(row.dataFilePath), 4000)
  } catch {
    return null
  }
}

function listClockTitle(createdLabel: string, created: number, updatedLabel: string, updated: number): string {
  return [
    created > 0 ? `${createdLabel} ${absoluteTime(created)}` : null,
    updated > 0 ? `${updatedLabel} ${absoluteTime(updated)}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

function DataObjectList(): React.JSX.Element {
  const t = useT()
  const listRef = useRef<HTMLDivElement>(null)
  const sourceKey = useSessionStore((s) =>
    appObjectListKey(s.conversations, (row) => isDbSession(row) && !row.archived)
  )
  const source = useMemo(
    () => useSessionStore.getState().conversations.filter((row) => isDbSession(row) && !row.archived),
    [sourceKey]
  )
  const library = coerceAppLibraries(useSessionStore((s) => s.settings.appLibraries)).data
  const selectedFolder = useAppFolderSelectedId('data')
  const filedFolder = filedAppFolderId(selectedFolder)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const dbSchemas = useSessionStore((s) => s.dbSchemas)
  const [counts, setCounts] = useState<Record<string, { tables: number; rows: number }>>({})
  const openAppObject = useSessionStore((s) => s.openAppObject)
  const createDbConversation = useSessionStore((s) => s.createDbConversation)
  const createDataFromFile = useSessionStore((s) => s.createDataFromFile)
  const setApplicationsDetailOpen = useSessionStore((s) => s.setApplicationsDetailOpen)

  const addDataFile = async (): Promise<void> => {
    const picked = await window.vav.files?.pickAttachments()
    if (!picked || !('ok' in picked) || !picked.ok) return
    const path = picked.paths.find((item) => isDataFilePath(item))
    if (!path) {
      useSessionStore.getState().showToast({
        kind: 'error',
        title: t('data.unsupportedFile')
      })
      return
    }
    assignCreatedAppObject('data', await createDataFromFile(path))
    setApplicationsDetailOpen(true)
  }
  const { menuFor, renamingId, beginRename, renameConversation, requestDelete } =
    useAppObjectConversationMenu()
  const list = useAppObjectList()
  const rows = useMemo(
    () =>
      applyAppObjectList(source, {
        query: list.query,
        sort: list.sort,
        fields: (row) => [row.title, row.dataFilePath],
        meta: (row) => ({
          title: row.title,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt
        }),
        include: (row) => {
          if (filedFolder && library.assignments[row.id] !== filedFolder) return false
          return (
            list.filter === 'all' ||
            (list.filter === 'file' ? !!row.dataFilePath : !row.dataFilePath)
          )
        }
      }),
    [filedFolder, library.assignments, list.filter, list.query, list.sort, source]
  )
  const folderCounts = useMemo(
    () => appFolderCounts(library.assignments, source.map((row) => row.id)),
    [library.assignments, source]
  )
  const inFolderCount = filedFolder ? (folderCounts[filedFolder] ?? 0) : source.length

  useEffect(() => {
    if (selectedFolder === APP_FOLDER_ALL_ID) return
    if (!library.folders.some((folder) => folder.id === selectedFolder)) {
      setAppFolderSelectedId('data', APP_FOLDER_ALL_ID)
    }
  }, [library.folders, selectedFolder])
  const orderedIds = useMemo(() => rows.map((row) => row.id), [rows])
  const visibleSchemaKey = useMemo(
    () =>
      dataRowsNeedingSchema(rows, new Set(Object.keys(counts)))
        .map((row) => `${row.id}:${row.dataFilePath ?? ''}`)
        .join('|'),
    [counts, rows]
  )
  useEffect(() => {
    const needed = dataRowsNeedingSchema(rows, new Set(Object.keys(counts)))
    if (needed.length === 0) return
    let alive = true
    void Promise.all(
      needed.map(async (row) => {
        const totals = tableCounts(await loadAnalysisSchema(row))
        return totals ? ([row.id, totals] as const) : null
      })
    ).then((pairs) => {
      if (!alive) return
      setCounts((prev) => {
        const next = { ...prev }
        for (const pair of pairs) {
          if (pair) next[pair[0]] = pair[1]
        }
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [visibleSchemaKey])
  const { focusedId, selectedIds, select, selectAll, rowClass, selectionMods } =
    useAppObjectListSelection(orderedIds)
  const onMove = useCallback((id: string, range: boolean) => select(id, { shiftKey: range }), [select])
  useAppObjectListKeys({
    listRef,
    orderedIds,
    focusedId,
    selectedIds,
    onMove,
    onDelete: requestDelete,
    onSelectAll: selectAll
  })

  return (
    <div ref={listRef} className="applications-home knowledge-library" data-testid="data-home">
      <AppFolderRail
        folders={library.folders}
        allCount={source.length}
        counts={folderCounts}
        selectedId={selectedFolder}
        renamingId={renamingFolderId}
        allLabelKey="app.folder.allData"
        dragType={appFolderDragType('data')}
        testIdPrefix="data"
        onSelect={setAppFolderSelectedId.bind(null, 'data')}
        onBeginRename={setRenamingFolderId}
        onCreate={() => {
          const folder = createAppFolder('data', t('app.folder.untitled'))
          setAppFolderSelectedId('data', folder.id)
          setRenamingFolderId(folder.id)
        }}
        onRename={(id, name) => {
          setRenamingFolderId(null)
          renameAppFolder('data', id, name)
        }}
        onDelete={(id) => removeAppFolder('data', id)}
        onDropObjects={(folderId, objectIds) => moveAppFolderObjects('data', objectIds, folderId)}
        readDragIds={(transfer) => readAppFolderDrag(transfer, 'data')}
      />
      <div className="knowledge-library-main">
      {inFolderCount > 0 ? (
        <AppObjectListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          filter={list.filter}
          filters={[
            { id: 'all', labelKey: 'app.list.filter.all' },
            { id: 'database', labelKey: 'app.list.filter.database' },
            { id: 'file', labelKey: 'app.list.filter.file' }
          ]}
          onFilterChange={list.setFilter}
          sort={list.sort}
          onSortChange={list.setSort}
          askKind="Data"
          testIdPrefix="data-list"
        />
      ) : null}
      <div className="applications-object-body">
        {inFolderCount === 0 ? (
          <AppEmptyState
            title={filedFolder ? t('app.folder.emptyTitle') : t('data.emptyTitle')}
            description={filedFolder ? t('app.folder.emptyDesc') : t('data.emptyDesc')}
            kind="data"
          >
            <Button
              icon={<Database size={14} />}
              variant="secondary"
              title={t('db.new')}
              label={t('db.new')}
              onClick={() => {
                void createDbConversation().then((id) => {
                  assignCreatedAppObject('data', id)
                  setApplicationsDetailOpen(true)
                })
              }}
            />
            <Button
              icon={<FilePlus2 size={14} />}
              variant="secondary"
              title={t('data.addFile')}
              label={t('data.addFile')}
              onClick={() => void addDataFile()}
            />
          </AppEmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title={t('app.list.noMatchTitle')} description={t('app.list.noMatchDesc')} />
        ) : (
          <ul className="applications-object-rows">
            {rows.map((row) => {
              const cached =
                !row.dataFilePath && row.dbConnectionId ? dbSchemas[row.dbConnectionId] : undefined
              const totals = counts[row.id] ?? tableCounts(cached)
              return (
              <li key={row.id} className={selectionMods(row.id) || undefined}>
                <div
                  role="button"
                  tabIndex={0}
                  draggable={renamingId !== row.id}
                  className={rowClass(row.id)}
                  data-testid="data-object-row"
                  data-active={row.id === focusedId ? 'true' : 'false'}
                  data-selected={selectedIds.includes(row.id) ? 'true' : 'false'}
                  onDragStart={(event) => {
                    const picked = selectedIds.includes(row.id) ? selectedIds : [row.id]
                    event.dataTransfer.setData(appFolderDragType('data'), JSON.stringify(picked))
                    event.dataTransfer.effectAllowed = 'move'
                    event.currentTarget.classList.add('is-dragging')
                  }}
                  onDragEnd={(event) => event.currentTarget.classList.remove('is-dragging')}
                  {...appObjectPointerHandlers({
                    onSelect: (event) => select(row.id, event),
                    onOpen: () => openAppObject(row.id),
                    onMenu: (event) => {
                      const { ids, collapse } = appObjectContextTargets(row.id, selectedIds)
                      if (collapse) select(row.id)
                      const targets = rows.filter((item) => ids.includes(item.id))
                      void showMenu(menuFor(targets), menuPoint(event))
                    }
                  })}
                >
                  <span className="applications-object-row-icon" aria-hidden>
                    {row.dataFilePath ? (
                      <FileText strokeWidth={1.8} />
                    ) : (
                      <Database strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="applications-object-row-copy">
                    {renamingId === row.id ? (
                      <RenameField
                        initial={row.title}
                        onCommit={(next) => void renameConversation(row.id, next)}
                        onCancel={() => beginRename(null)}
                      />
                    ) : (
                      <span className="applications-object-row-title">
                        {row.dataFilePath
                          ? basename(row.dataFilePath) || row.title
                          : isPlaceholderDbTitle(row.title)
                            ? t('db.untitled')
                            : row.title}
                      </span>
                    )}
                    <ObjectListLine
                      title={listClockTitle(
                        t('object.fact.created'),
                        row.createdAt,
                        t('object.fact.updated'),
                        row.updatedAt
                      )}
                      parts={[
                        { label: t('object.fact.created'), value: relativeTime(row.createdAt) },
                        { label: t('object.fact.updated'), value: relativeTime(row.updatedAt) },
                        {
                          label: t('object.fact.tables'),
                          value: totals ? formatFactCount(totals.tables) : null
                        },
                        {
                          label: t('object.fact.rows'),
                          value: totals ? formatFactCount(totals.rows) : null
                        }
                      ]}
                    />
                  </span>
                  <span className="applications-object-row-tag">
                    {row.dataFilePath ? t('app.list.filter.file') : t('app.list.filter.database')}
                  </span>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  )
}

function KnowledgeObjectList(): React.JSX.Element {
  const t = useT()
  const listRef = useRef<HTMLDivElement>(null)
  const sourceKey = useSessionStore((s) =>
    appObjectListKey(s.conversations, (row) => isKnowledgeSession(row) && !row.archived)
  )
  const source = useMemo(
    () =>
      useSessionStore.getState().conversations.filter((row) => isKnowledgeSession(row) && !row.archived),
    [sourceKey]
  )
  const openAppObject = useSessionStore((s) => s.openAppObject)
  const createKnowledgeNote = useSessionStore((s) => s.createKnowledgeNote)
  const importKnowledgeDocument = useSessionStore((s) => s.importKnowledgeDocument)
  const setApplicationsDetailOpen = useSessionStore((s) => s.setApplicationsDetailOpen)
  const { menuFor, renamingId, beginRename, renameConversation, requestDelete } =
    useAppObjectConversationMenu()
  const selectedFolder = useKnowledgeFolderId()
  const filedFolder = selectedFolder === KNOWLEDGE_ALL_NOTES_ID ? null : selectedFolder
  const showToast = useSessionStore((s) => s.showToast)
  const [hosts, setHosts] = useState<KnowledgeHost[]>([])
  const [folders, setFolders] = useState<KnowledgeFolder[]>([])
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [noteFace, setNoteFace] = useState<Record<string, { words: number; preview: string }>>({})
  const list = useAppObjectList()

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [listed, listedFolders] = await Promise.all([
        window.vav.knowledge?.list().catch(() => []),
        window.vav.knowledge?.listFolders().catch(() => [])
      ])
      if (!alive) return
      setHosts(listed ?? [])
      setFolders(listedFolders ?? [])
    }
    void load()
    return window.vav.knowledge?.onChanged(() => {
      void load()
    })
  }, [])

  useEffect(() => {
    if (selectedFolder === KNOWLEDGE_ALL_NOTES_ID) return
    if (!folders.some((folder) => folder.id === selectedFolder)) {
      setKnowledgeFolderId(KNOWLEDGE_ALL_NOTES_ID)
    }
  }, [folders, selectedFolder])

  useEffect(() => {
    if (hosts.length === 0) return
    useSessionStore.setState((state) => {
      let changed = false
      const conversations = state.conversations.map((row) => {
        const host = hosts.find((item) => item.conversationId === row.id)
        const title = host?.title.trim()
        if (!title || row.title === title) return row
        changed = true
        return { ...row, title }
      })
      return changed ? { conversations } : state
    })
  }, [hosts])

  const hostByConversation = useMemo(() => {
    const map = new Map<string, KnowledgeHost>()
    for (const host of hosts) {
      if (host.conversationId) map.set(host.conversationId, host)
    }
    return map
  }, [hosts])

  const folderConversationIds = useMemo(
    () =>
      source
        .filter((row) => !filedFolder || hostByConversation.get(row.id)?.folderId === filedFolder)
        .map((row) => row.id),
    [filedFolder, hostByConversation, source]
  )
  const visibleNoteIds = useMemo(
    () => knowledgeNoteIdsForPreview(hosts, folderConversationIds),
    [folderConversationIds, hosts]
  )
  const visibleNoteKey = visibleNoteIds.join('|')
  useEffect(() => {
    const needed = visibleNoteIds.filter((id) => !(id in noteFace))
    if (needed.length === 0) return
    let alive = true
    void Promise.all(
      needed.map(async (id) => {
        const note = await window.vav.knowledge?.readNote(id)
        if (!note) return [id, null] as const
        return [
          id,
          { words: countWritingUnits(note.markdown), preview: knowledgeNotePreview(note.markdown) }
        ] as const
      })
    ).then((pairs) => {
      if (!alive) return
      setNoteFace((prev) => {
        const next = { ...prev }
        for (const [id, face] of pairs) {
          if (face) next[id] = face
        }
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [visibleNoteKey])

  const rows = useMemo(
    () =>
      applyAppObjectList(source, {
        query: list.query,
        sort: list.sort,
        fields: (row) => {
          const host = hostByConversation.get(row.id)
          return [row.title, host?.kind, host?.sourcePath, host ? noteFace[host.id]?.preview : '']
        },
        meta: (row) => ({
          title: row.title,
          updatedAt: hostByConversation.get(row.id)?.updatedAt ?? row.updatedAt,
          createdAt: hostByConversation.get(row.id)?.createdAt ?? row.createdAt
        }),
        include: (row) => {
          const host = hostByConversation.get(row.id)
          if (filedFolder && host?.folderId !== filedFolder) return false
          if (list.filter === 'all') return true
          const kind = host?.kind ?? 'note'
          return list.filter === 'book' ? kind === 'document' : kind === 'note'
        }
      }),
    [filedFolder, hostByConversation, list.filter, list.query, list.sort, noteFace, source]
  )
  const folderCounts = useMemo(() => {
    const byId: Record<string, number> = {}
    for (const row of source) {
      const folderId = hostByConversation.get(row.id)?.folderId
      if (folderId) byId[folderId] = (byId[folderId] ?? 0) + 1
    }
    return byId
  }, [hostByConversation, source])
  const inFolderCount = filedFolder ? (folderCounts[filedFolder] ?? 0) : source.length
  const orderedIds = useMemo(() => rows.map((row) => row.id), [rows])
  const { focusedId, selectedIds, select, selectAll, rowClass, selectionMods } =
    useAppObjectListSelection(orderedIds)
  const onMove = useCallback((id: string, range: boolean) => select(id, { shiftKey: range }), [select])
  useAppObjectListKeys({
    listRef,
    orderedIds,
    focusedId,
    selectedIds,
    onMove,
    onDelete: requestDelete,
    onSelectAll: selectAll
  })

  const createHere = (): void => {
    void createKnowledgeNote(filedFolder)
  }
  const importHere = (): void => {
    void (async () => {
      const picked = await window.vav.files?.pickAttachments()
      if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
      await importKnowledgeDocument(picked.paths[0], filedFolder)
      setApplicationsDetailOpen(true)
    })()
  }

  return (
    <div ref={listRef} className="applications-home knowledge-library" data-testid="knowledge-home">
      <KnowledgeFolderRail
        folders={folders}
        allCount={source.length}
        counts={folderCounts}
        selectedId={selectedFolder}
        renamingId={renamingFolderId}
        onSelect={setKnowledgeFolderId}
        onBeginRename={setRenamingFolderId}
        onCreate={() => {
          void (async () => {
            try {
              const folder = await window.vav.knowledge?.createFolder(t('knowledge.untitledFolder'))
              if (!folder) return
              setFolders((prev) => (prev.some((row) => row.id === folder.id) ? prev : [...prev, folder]))
              setKnowledgeFolderId(folder.id)
              setRenamingFolderId(folder.id)
            } catch (err) {
              showToast({
                kind: 'error',
                title: t('knowledge.folderCreateFailed'),
                description: err instanceof Error ? err.message : String(err)
              })
            }
          })()
        }}
        onRename={(id, name) => {
          setRenamingFolderId(null)
          void window.vav.knowledge?.renameFolder(id, name)
        }}
        onDelete={(id) => {
          if (selectedFolder === id) setKnowledgeFolderId(KNOWLEDGE_ALL_NOTES_ID)
          void window.vav.knowledge?.removeFolder(id)
        }}
        onDropNotes={(folderId, hostIds) => {
          void window.vav.knowledge?.move(hostIds, folderId)
        }}
      />
      <div className="knowledge-library-main">
      {inFolderCount > 0 ? (
        <AppObjectListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          filter={list.filter}
          filters={[
            { id: 'all', labelKey: 'app.list.filter.all' },
            { id: 'note', labelKey: 'app.list.filter.note' },
            { id: 'book', labelKey: 'app.list.filter.book' }
          ]}
          onFilterChange={list.setFilter}
          sort={list.sort}
          onSortChange={list.setSort}
          askKind="Knowledge"
          testIdPrefix="knowledge-list"
        />
      ) : null}
      <div className="applications-object-body">
        {inFolderCount === 0 ? (
          <AppEmptyState
            title={filedFolder ? t('knowledge.folderEmptyTitle') : t('knowledge.emptyTitle')}
            description={filedFolder ? t('knowledge.folderEmptyDesc') : t('knowledge.emptyDesc')}
            kind="knowledge"
          >
            <Button
              icon={<StickyNote size={14} />}
              variant="secondary"
              title={t('knowledge.newNote')}
              label={t('knowledge.newNote')}
              onClick={createHere}
            />
            <Button
              icon={<BookPlus size={14} />}
              variant="secondary"
              title={t('knowledge.importDocument')}
              label={t('knowledge.importDocument')}
              onClick={importHere}
            />
          </AppEmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title={t('app.list.noMatchTitle')} description={t('app.list.noMatchDesc')} />
        ) : (
          <ul className="applications-object-rows">
            {rows.map((row) => {
              const host = hostByConversation.get(row.id)
              return (
                <li key={row.id} className={selectionMods(row.id) || undefined}>
                  <div
                    role="button"
                    tabIndex={0}
                    draggable={renamingId !== row.id}
                    className={`${rowClass(row.id)} knowledge-note-row`}
                    data-testid="knowledge-object-row"
                    data-active={row.id === focusedId ? 'true' : 'false'}
                    data-selected={selectedIds.includes(row.id) ? 'true' : 'false'}
                    onDragStart={(event) => {
                      const picked = selectedIds.includes(row.id) ? selectedIds : [row.id]
                      const hostIds = picked
                        .map((id) => hostByConversation.get(id)?.id)
                        .filter((id): id is string => !!id)
                      event.dataTransfer.setData(KNOWLEDGE_DRAG_TYPE, JSON.stringify(hostIds))
                      event.dataTransfer.effectAllowed = 'move'
                      event.currentTarget.classList.add('is-dragging')
                    }}
                    onDragEnd={(event) => event.currentTarget.classList.remove('is-dragging')}
                    {...appObjectPointerHandlers({
                      onSelect: (event) => select(row.id, event),
                      onOpen: () => openAppObject(row.id),
                      onMenu: (event) => {
                        const { ids, collapse } = appObjectContextTargets(row.id, selectedIds)
                        if (collapse) select(row.id)
                        const targets = rows.filter((item) => ids.includes(item.id))
                        void showMenu(menuFor(targets), menuPoint(event))
                      }
                    })}
                  >
                    <span className="knowledge-note-row-title">
                      {host?.kind === 'document' ? (
                        <BookOpen className="knowledge-note-row-mark" size={14} strokeWidth={1.75} aria-hidden />
                      ) : null}
                      {renamingId === row.id ? (
                        <RenameField
                          initial={row.title}
                          onCommit={(next) => void renameConversation(row.id, next)}
                          onCancel={() => beginRename(null)}
                        />
                      ) : (
                        <span>{row.title}</span>
                      )}
                    </span>
                    <time
                      className="knowledge-note-row-when"
                      dateTime={new Date(host?.updatedAt ?? row.updatedAt).toISOString()}
                      title={listClockTitle(
                        t('object.fact.created'),
                        host?.createdAt ?? row.createdAt,
                        t('object.fact.updated'),
                        host?.updatedAt ?? row.updatedAt
                      )}
                    >
                      {relativeTime(host?.updatedAt ?? row.updatedAt)}
                    </time>
                    <span
                      className={`knowledge-note-row-preview${
                        host?.kind !== 'document' && !(host && noteFace[host.id]?.preview)
                          ? ' is-empty'
                          : ''
                      }`}
                      data-testid="knowledge-object-excerpt"
                      title={
                        host?.kind === 'document'
                          ? host.sourcePath || undefined
                          : host && noteFace[host.id]?.preview
                            ? noteFace[host.id]!.preview
                            : undefined
                      }
                    >
                      {host?.kind === 'document'
                        ? host.sourcePath
                          ? basename(host.sourcePath)
                          : t('knowledge.document')
                        : host && noteFace[host.id]?.preview
                          ? noteFace[host.id]!.preview
                          : t('knowledge.previewEmpty')}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  )
}

function DevicesObjectList({
  selectedId,
  onSelect,
  onOpen
}: {
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  const t = useT()
  const listRef = useRef<HTMLDivElement>(null)
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const list = useAppObjectList({ defaultSort: 'name' })
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedId ? [selectedId] : [])
  const rows = useMemo(
    () =>
      applyAppObjectList(services, {
        query: list.query,
        sort: list.sort,
        fields: (service) => [service.name, service.id],
        meta: (service) => ({
          title: service.name,
          updatedAt: isLocalMachine(service.id) ? 1 : 0,
          createdAt: isLocalMachine(service.id) ? 1 : 0
        }),
        include: (service) =>
          list.filter === 'all' ||
          (list.filter === 'local' ? isLocalMachine(service.id) : !isLocalMachine(service.id))
      }),
    [list.filter, list.query, list.sort, services]
  )
  const orderedIds = useMemo(() => rows.map((row) => row.id), [rows])
  const pick = useCallback(
    (id: string, event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => {
      const next = nextConversationSelection({
        id,
        selectedIds,
        activeId: selectedId,
        additive: !!(event?.metaKey || event?.ctrlKey),
        range: !!event?.shiftKey,
        listedIds: orderedIds
      })
      setSelectedIds(next)
      onSelect(id)
    },
    [onSelect, orderedIds, selectedId, selectedIds]
  )
  const onMove = useCallback((id: string, range: boolean) => pick(id, { shiftKey: range }), [pick])
  useAppObjectListKeys({
    listRef,
    orderedIds,
    focusedId: selectedId,
    selectedIds,
    onMove,
    onSelectAll: () => {
      if (orderedIds.length === 0) return
      setSelectedIds([...orderedIds])
    }
  })

  return (
    <div ref={listRef} className="applications-home" data-testid="devices-home">
      {services.length > 0 ? (
        <AppObjectListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          filter={list.filter}
          filters={[
            { id: 'all', labelKey: 'app.list.filter.all' },
            { id: 'local', labelKey: 'app.list.filter.local' },
            { id: 'remote', labelKey: 'app.list.filter.remote' }
          ]}
          onFilterChange={list.setFilter}
          sort={list.sort}
          onSortChange={list.setSort}
          testIdPrefix="devices-list"
        />
      ) : null}
      <div className="applications-object-body">
        {services.length === 0 ? (
          <EmptyState title={t('sidebar.emptyRemoteTitle')} description={t('sidebar.devices')} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('app.list.noMatchTitle')} description={t('app.list.noMatchDesc')} />
        ) : (
          <ul className="applications-object-rows">
            {rows.map((service) => (
              <li
                key={service.id}
                className={appObjectSelectionMods(service.id, selectedIds, orderedIds) || undefined}
              >
                <button
                  type="button"
                  className={appObjectRowClassName(service.id, selectedIds, orderedIds)}
                  data-testid="device-object-row"
                  data-machine-id={service.id}
                  data-active={service.id === selectedId ? 'true' : 'false'}
                  data-selected={selectedIds.includes(service.id) ? 'true' : 'false'}
                  {...appObjectPointerHandlers({
                    onSelect: (event) => pick(service.id, event),
                    onOpen: () => {
                      setSelectedIds([service.id])
                      onOpen(service.id)
                    },
                    onMenu: (event) => {
                      const { ids, collapse } = appObjectContextTargets(service.id, selectedIds)
                      if (collapse) pick(service.id)
                      const remotes = ids.filter((id) => !isLocalMachine(id))
                      if (ids.length > 1) {
                        void showMenu(
                          remotes.length === 0
                            ? []
                            : [
                                {
                                  label: t('machines.forget'),
                                  onSelect: () => {
                                    for (const id of remotes) void window.vav.hosts.forget(id)
                                  }
                                }
                              ],
                          menuPoint(event)
                        )
                        return
                      }
                      const items: MenuItem[] = [
                        ...(service.id === windowMachineId
                          ? []
                          : [
                              {
                                label: t('sidebar.switchService'),
                                onSelect: () => {
                                  void (async () => {
                                    await useSessionStore.getState().switchMachine(service.id)
                                    await window.vav.hosts.show(service.id)
                                  })()
                                }
                              }
                            ]),
                        {
                          label: t('sidebar.setDefaultService'),
                          onSelect: () => void setDefaultMachine(service.id)
                        },
                        {
                          label: t('sidebar.configureService'),
                          onSelect: () =>
                            useSessionStore.getState().openSettings('agents', undefined, service.id)
                        },
                        ...(isLocalMachine(service.id)
                          ? []
                          : [
                              {
                                label: t('machines.forget'),
                                onSelect: () => void window.vav.hosts.forget(service.id)
                              }
                            ])
                      ]
                      void showMenu(items, menuPoint(event))
                    }
                  })}
                >
                  <span className="applications-object-row-icon" aria-hidden>
                    {isLocalMachine(service.id) ? (
                      <Laptop strokeWidth={1.8} />
                    ) : (
                      <MonitorSmartphone strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="applications-object-row-title">{service.name}</span>
                  {isLocalMachine(service.id) ? (
                    <span className="applications-object-row-tag is-local">
                      {t('sidebar.thisMachine')}
                    </span>
                  ) : (
                    <span className="applications-object-row-tag">{t('app.list.filter.remote')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DevicesDetailActions({ selectedId }: { selectedId: string }): React.JSX.Element | null {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const current = services.find((service) => service.id === selectedId) ?? services[0]
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)

  if (!current) return null

  const switchService = (machineId: string): void => {
    if (machineId === windowMachineId) return
    void (async () => {
      await useSessionStore.getState().switchMachine(machineId)
      await window.vav.hosts.show(machineId)
    })()
  }

  return (
    <>
      {current.id !== windowMachineId ? (
        <Button
          variant="ghost"
          size="sm"
          title={t('sidebar.switchService')}
          label={t('sidebar.switchService')}
          onClick={() => switchService(current.id)}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        title={t('sidebar.setDefaultService')}
        label={t('sidebar.setDefaultService')}
        onClick={() => void setDefaultMachine(current.id)}
      />
      <Button
        variant="ghost"
        size="sm"
        title={t('sidebar.pairDevice')}
        label={t('sidebar.pairDevice')}
        onClick={() => useSessionStore.getState().openSettings('connect', undefined, current.id)}
      />
    </>
  )
}

function DevicesObjectDetail({ selectedId }: { selectedId: string }): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const current = services.find((service) => service.id === selectedId) ?? services[0]
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))

  if (!current) {
    return <EmptyState title={t('sidebar.devices')} />
  }

  const metaLine = [
    isLocalMachine(current.id) ? t('sidebar.thisMachine') : null,
    defaultMachineId === current.id ? t('sidebar.setDefaultService') : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="applications-home applications-device-detail" data-testid="devices-detail">
      <div className="applications-device-hero">
        <span className="applications-device-hero-icon" aria-hidden>
          {isLocalMachine(current.id) ? (
            <Laptop strokeWidth={1.8} />
          ) : (
            <MonitorSmartphone strokeWidth={1.8} />
          )}
        </span>
        <div className="applications-device-hero-text">
          <p className="applications-device-name">{current.name}</p>
          {metaLine ? <p className="applications-device-meta">{metaLine}</p> : null}
        </div>
      </div>
      <div className="applications-device-more">
        <Button
          variant="secondary"
          size="sm"
          title={t('sidebar.configureService')}
          label={t('sidebar.configureService')}
          onClick={() => useSessionStore.getState().openSettings('agents', undefined, current.id)}
        />
        {!isLocalMachine(current.id) ? (
          <Button
            variant="secondary"
            size="sm"
            title={t('machines.forget')}
            label={t('machines.forget')}
            onClick={() => void window.vav.hosts.forget(current.id)}
          />
        ) : null}
        {current.id !== windowMachineId ? null : defaultMachineId === current.id ? null : (
          <Button
            variant="secondary"
            size="sm"
            title={t('sidebar.setDefaultService')}
            label={t('sidebar.setDefaultService')}
            onClick={() => void setDefaultMachine(current.id)}
          />
        )}
      </div>
    </div>
  )
}
