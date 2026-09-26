import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileText, FileX, FolderOpen } from 'lucide-react'
import type { FileSessionListEntry } from '@shared/ipc'
import { STORAGE_SOURCES, type StorageSource } from '@shared/storageSource'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { useShowShellLeading } from '../lib/sidebarLayout'
import { basename, dirname } from '../lib/path'
import { relativeTime } from '../lib/format'
import { hostMachineLabel, uniqueRecentFileRows } from '../lib/sidebarList'
import { isLocalMachine, LOCAL_MACHINE_ID, normalizeMachineId } from '@shared/workspaceHost'
import {
  fileSessionSelectHint,
  openExistingFileSession,
  openPickedFileSessions
} from '../lib/openFileSession'
import { showMenu } from '../lib/nativeMenu'
import { storageCrossSurfaceItems } from '../lib/storageCrossActions'
import { STORAGE_SOURCE_LABEL_KEY } from '../lib/storageSources'
import { appObjectPointerHandlers, menuPoint, useAppObjectConversationMenu } from '../lib/appObjectRow'
import { ShellLeadingControls } from './ShellLeadingControls'
import { appObjectContextTargets, applyAppObjectList } from '../lib/appObjectList'
import {
  AppObjectListToolbar,
  useAppObjectList,
  useAppObjectListKeys,
  useAppObjectListSelection
} from './AppObjectListToolbar'
import { AppEmptyState } from './AppEmptyState'
import { Button, EmptyState } from './ui'
import { fileSessionListKey } from '../lib/apps/appColumnLoad'
import { warmMachineFilesBrowser } from '../lib/apps/warmAppViews'

export function FileRecentsPanel({
  embedded = false,
  onOpenDetail
}: {
  embedded?: boolean
  onOpenDetail?: () => void
} = {}): React.JSX.Element {
  const t = useT()
  const source = useSessionStore((s) => s.filesSource)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const fileSessionKey = useSessionStore((s) => fileSessionListKey(s.conversations))
  const shellLeading = useShowShellLeading()
  const showShellLeading = !embedded && shellLeading
  const listRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<FileSessionListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const list = useAppObjectList()
  const { menuFor, requestDelete } = useAppObjectConversationMenu()
  const visibleRows = useMemo(
    () =>
      applyAppObjectList(rows, {
        query: list.query,
        sort: list.sort,
        fields: (row) => [row.title, row.path, basename(row.path)],
        meta: (row) => ({
          title: basename(row.path) || row.title,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt
        }),
        include: (row) =>
          list.filter === 'all' ||
          (list.filter === 'available' ? row.pathStatus === 'ok' : row.pathStatus !== 'ok')
      }),
    [list.filter, list.query, list.sort, rows]
  )
  const orderedIds = useMemo(() => visibleRows.map((row) => row.sessionId), [visibleRows])
  const { focusedId, selectedIds, select, selectAll, rowClass, selectionMods } =
    useAppObjectListSelection(orderedIds)
  const onMove = useCallback((id: string, range: boolean) => select(id, { shiftKey: range }), [select])
  const [icloud, setIcloud] = useState<{ path: string | null; available: boolean } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const listed = await window.vav.fileSessions.listAll()
      setRows(uniqueRecentFileRows(listed))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [windowMachineId])

  const deleteRows = useCallback(
    (ids: string[]) => {
      const conversations = useSessionStore.getState().conversations
      const known = ids.filter((id) => conversations.some((item) => item.id === id))
      if (known.length) requestDelete(known)
      for (const id of ids) {
        if (known.includes(id)) continue
        const row = visibleRows.find((item) => item.sessionId === id)
        if (!row) continue
        void window.vav.fileSessions.forceDelete(row.fileId, [row.sessionId]).then(() => {
          void refresh()
        })
      }
    },
    [refresh, requestDelete, visibleRows]
  )

  useAppObjectListKeys({
    listRef,
    orderedIds,
    focusedId,
    selectedIds,
    onMove,
    onDelete: deleteRows,
    onSelectAll: selectAll
  })

  useEffect(() => {
    void refresh()
  }, [refresh, fileSessionKey, windowMachineId])

  useEffect(() => {
    if (source !== 'icloud') return
    let alive = true
    void window.vav.hosts.specialFolder(windowMachineId, 'icloud').then((result) => {
      if (!alive) return
      setIcloud({ path: result.path, available: result.available })
    })
    return () => {
      alive = false
    }
  }, [source, windowMachineId])

  const canOpenLocal = source === 'recent' && isLocalMachine(windowMachineId)
  const openPicker = useCallback((): void => {
    void openPickedFileSessions().then((opened) => {
      if (!opened) return
      void refresh()
      onOpenDetail?.()
    })
  }, [onOpenDetail, refresh])

  const browseIcloud = source === 'icloud' && Boolean(icloud?.available && icloud.path)
  const MachineFilesBrowser = warmMachineFilesBrowser.use(source === 'thisMac' || browseIcloud)

  return (
    <main
      ref={listRef}
      className={`detail file-recents${embedded ? ' is-embedded' : ''}`}
      data-testid="file-recents"
    >
      {embedded ? null : (
        <header
          className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
        >
          <div className="agent-mode-chrome-row">
            {showShellLeading ? (
              <div className="agent-mode-shell-leading">
                <ShellLeadingControls />
              </div>
            ) : null}
            <span className="spacer" />
            {canOpenLocal ? (
              <Button
                variant="secondary"
                size="sm"
                testId="open-a-file"
                title={t('sidebar.openAFile')}
                label={t('sidebar.openAFile')}
                onClick={openPicker}
              />
            ) : null}
          </div>
        </header>
      )}
      <AppObjectListToolbar
        query={list.query}
        onQueryChange={list.setQuery}
        filter={list.filter}
        filters={[
          { id: 'all', labelKey: 'app.list.filter.all' },
          { id: 'available', labelKey: 'app.list.filter.available' },
          { id: 'missing', labelKey: 'app.list.filter.missing' }
        ]}
        onFilterChange={list.setFilter}
        sort={list.sort}
        onSortChange={list.setSort}
        askKind="Storage"
        testIdPrefix="file-recents"
        leading={<StorageSourceSelect />}
        searchFixed
        listControls={source === 'recent'}
      />
      <div className="storage-source-body">
      {source === 'thisMac' ? (
        MachineFilesBrowser ? (
        <MachineFilesBrowser
          key={`mac:${windowMachineId}`}
          persistKey={`mac:${windowMachineId}`}
          onFileOpened={onOpenDetail}
        />
        ) : (
          <div className="muted tiny" style={{ padding: 16 }}>
            {t('common.loading')}
          </div>
        )
      ) : browseIcloud ? (
        MachineFilesBrowser ? (
        <MachineFilesBrowser
          key={`icloud:${windowMachineId}:${icloud!.path}`}
          root={icloud!.path!}
          persistKey={`icloud:${windowMachineId}`}
          onFileOpened={onOpenDetail}
        />
        ) : (
          <div className="muted tiny" style={{ padding: 16 }}>
            {t('common.loading')}
          </div>
        )
      ) : source === 'icloud' && icloud === null ? (
        <div className="muted tiny" style={{ padding: 16 }}>
          {t('common.loading')}
        </div>
      ) : source === 'icloud' ? (
        <AppEmptyState
          kind="storage-icloud"
          title={t('sidebar.iCloudUnavailable')}
          description={t('sidebar.iCloudUnavailableDesc')}
        />
      ) : source === 'cloudDisk' ? (
        <AppEmptyState
          kind="storage-cloud"
          title={t('sidebar.cloudDiskSoon')}
          description={t('sidebar.cloudDiskSoonDesc')}
        />
      ) : (
        <div className={`file-recents-body${embedded ? ' applications-home' : ''}`}>
          {loading ? null : rows.length === 0 ? (
            <AppEmptyState
              kind="storage"
              title={t('sidebar.recentFilesEmpty')}
              description={t('sidebar.recentFilesEmptyDesc')}
            >
              {canOpenLocal ? (
                <Button
                  variant="secondary"
                  icon={<FolderOpen size={14} strokeWidth={2} aria-hidden />}
                  title={t('sidebar.openAFile')}
                  label={t('sidebar.openAFile')}
                  onClick={openPicker}
                />
              ) : null}
            </AppEmptyState>
          ) : (
            <div className={embedded ? 'applications-object-body' : 'file-recents-card'}>
            {visibleRows.length === 0 ? (
              <EmptyState title={t('app.list.noMatchTitle')} description={t('app.list.noMatchDesc')} />
            ) : (
              <ul className="inline-review-files file-recents-files">
                {visibleRows.map((row) => {
                  const name = basename(row.path) || row.path
                  const folder = basename(dirname(row.path)) || dirname(row.path)
                  const missing =
                    row.pathStatus === 'dir_missing'
                      ? t('sidebar.dirNotExist')
                      : row.pathStatus === 'file_missing'
                        ? t('sidebar.fileNotExist')
                        : null
                  const meta = missing
                    ? `${folder} · ${missing}`
                    : `${folder} · ${relativeTime(row.updatedAt)}`
                  const cross = storageCrossSurfaceItems(row.path)
                  const openRow = (): void => {
                    select(row.sessionId)
                    openExistingFileSession(
                      row.path,
                      row.sessionId,
                      fileSessionSelectHint(row)
                    )
                    onOpenDetail?.()
                  }
                  return (
                    <li
                      key={row.path}
                      className={['inline-review-file', selectionMods(row.sessionId)]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid="file-recent-row"
                    >
                      <div className="inline-review-file-main">
                        <button
                          type="button"
                          className={rowClass(row.sessionId, 'inline-review-file-row applications-object-row')}
                          data-active={row.sessionId === focusedId ? 'true' : 'false'}
                          data-selected={selectedIds.includes(row.sessionId) ? 'true' : 'false'}
                          title={row.path}
                          {...appObjectPointerHandlers({
                            onSelect: (event) => select(row.sessionId, event),
                            onOpen: openRow,
                            onMenu: (event) => {
                              const { ids, collapse } = appObjectContextTargets(
                                row.sessionId,
                                selectedIds
                              )
                              if (collapse) select(row.sessionId)
                              const listed = useSessionStore.getState().conversations
                              const targets = ids
                                .map((id) => listed.find((item) => item.id === id))
                                .filter((item): item is NonNullable<typeof item> => !!item)
                              if (ids.length > 1 && targets.length !== ids.length) {
                                void showMenu(
                                  [
                                    {
                                      label: t('sidebar.menu.deleteCount', { count: ids.length }),
                                      destructive: true,
                                      onSelect: () => deleteRows(ids)
                                    }
                                  ],
                                  menuPoint(event)
                                )
                                return
                              }
                              if (targets.length > 0) {
                                void showMenu(
                                  menuFor(targets, targets.length === 1 ? cross : []),
                                  menuPoint(event)
                                )
                                return
                              }
                              void showMenu(
                                [
                                  ...cross,
                                  ...(cross.length > 0 ? [{ label: '', divider: true }] : []),
                                  {
                                    label: t('sidebar.menu.delete'),
                                    destructive: true,
                                    onSelect: () => deleteRows([row.sessionId])
                                  }
                                ],
                                menuPoint(event)
                              )
                            }
                          })}
                        >
                          <span
                            className={`applications-object-row-icon${missing ? ' is-missing' : ''}`}
                            aria-hidden
                          >
                            {missing ? <FileX strokeWidth={1.8} /> : <FileText strokeWidth={1.8} />}
                          </span>
                          <span className="inline-review-file-name">{name}</span>
                          <span className="inline-review-file-meta">{meta}</span>
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            </div>
          )}
        </div>
      )}
      </div>
    </main>
  )
}

function StorageSourceSelect(): React.JSX.Element {
  const t = useT()
  const source = useSessionStore((s) => s.filesSource)
  const setFilesSource = useSessionStore((s) => s.setFilesSource)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const hosts = useSessionStore((s) => s.hosts)
  const machineLabel = isLocalMachine(windowMachineId)
    ? t('sidebar.thisMac')
    : hostMachineLabel(windowMachineId, hosts, LOCAL_MACHINE_ID, t('sidebar.thisMac'))

  return (
    <div className="font-select file-source-select">
      <select
        className="text-field font-select-field"
        data-testid="file-source-select"
        data-value={source}
        value={source}
        aria-label={t('sidebar.filesSource')}
        onChange={(event) => setFilesSource(event.target.value as StorageSource)}
      >
        {STORAGE_SOURCES.map((id) => (
          <option key={id} value={id} data-testid={`storage-source-${id}`}>
            {id === 'thisMac' ? machineLabel : t(STORAGE_SOURCE_LABEL_KEY[id])}
          </option>
        ))}
      </select>
      <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
    </div>
  )
}
