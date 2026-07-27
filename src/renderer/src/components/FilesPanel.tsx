import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Columns3,
  File as FileIcon,
  Folder,
  FolderSync,
  Info,
  List,
  Pencil,
  Plus
} from 'lucide-react'
import { IGNORED_NAMES, IGNORED_SUFFIXES } from '@shared/types'
import {
  FILE_SORT_OPTIONS,
  normalizeFileSortKey,
  type FileEntry,
  type FileSortKey,
  type FileViewMode
} from '@shared/types'
import { fileSortLabelKey } from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { tt } from '../i18n/useT'
import { formatBytes, isTemporaryWorkspace } from '../lib/format'
import { basename, dirname } from '../lib/path'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { Button, EmptyState, InlineAlert } from './ui'

function sortButtonLabel(key: FileSortKey, t: ReturnType<typeof useT>): string {
  if (key === 'none') return '—'
  return t(fileSortLabelKey(key))
}

export function FilesPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const createConversationInCurrentWorkspace = useSessionStore(
    (s) => s.createConversationInCurrentWorkspace
  )
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const tmp = useSessionStore((s) => s.tmp)
  const locateWorkspace = useSessionStore((s) => s.locateWorkspace)
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)
  const setSort = useWorkspaceStore((s) => s.setSort)
  const selectPath = useWorkspaceStore((s) => s.selectPath)
  const quickLook = useWorkspaceStore((s) => s.quickLook)
  const loadDirectory = useWorkspaceStore((s) => s.loadDirectory)
  const temporary = isTemporaryWorkspace(conversation?.workingDirectory ?? null, tmp)
  const viewMode: FileViewMode = settings.fileViewMode ?? 'tree'
  const [columnPath, setColumnPath] = useState<string[]>([])
  const [displayMode, setDisplayMode] = useState<FileViewMode>(viewMode)
  const [browserOpaque, setBrowserOpaque] = useState(true)

  useEffect(() => {
    if (visible && activeId) void ensureFilesLoaded(activeId)
  }, [visible, activeId, ensureFilesLoaded])

  // Restore Finder sort prefs into the active workspace once when it appears.
  useEffect(() => {
    if (!activeId || !workspace) return
    const key = normalizeFileSortKey(settings.fileSortKey)
    const ascending = settings.fileSortAscending ?? true
    if (workspace.sort === key && workspace.ascending === ascending) return
    void setSort(activeId, key, ascending)
    // Only sync from persisted settings when the workspace first binds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, workspace?.root])

  useEffect(() => {
    setColumnPath([])
  }, [workspace?.root])

  useEffect(() => {
    // Keep the browser visible when modes already match — a cancelled mid-fade
    // must not leave `data-opaque` unset (opacity: 0 forever).
    if (viewMode === displayMode) {
      setBrowserOpaque(true)
      return
    }
    setBrowserOpaque(false)
    const timer = window.setTimeout(() => {
      setDisplayMode(viewMode)
      requestAnimationFrame(() => setBrowserOpaque(true))
    }, 140) // --dur-hover
    return () => {
      window.clearTimeout(timer)
      setBrowserOpaque(true)
    }
  }, [viewMode, displayMode])

  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (event.code !== 'Space') return
      const selected = useWorkspaceStore.getState().workspaces[activeId]?.selectedPath
      if (!selected) return
      event.preventDefault()
      quickLook(activeId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, activeId, quickLook])

  if (!workspace?.root) {
    return (
      <EmptyState title={t('files.noWorkdirTitle')} description={t('files.noWorkdirDesc')} />
    )
  }

  const rootError = workspace.dirErrors[workspace.root]
  const changed = workspace.changedFiles

  const applySort = (key: FileSortKey): void => {
    const next = normalizeFileSortKey(key)
    const ascending =
      next !== 'none' && workspace.sort === next ? !workspace.ascending : true
    void setSort(activeId, next, ascending)
    void updateSettings({ fileSortKey: next, fileSortAscending: ascending })
  }

  const sortItems: MenuItem[] = FILE_SORT_OPTIONS.map((option) => ({
    label: t(fileSortLabelKey(option.key)),
    checked: normalizeFileSortKey(workspace.sort) === option.key,
    onSelect: () => applySort(option.key)
  }))

  const openViewer = (path: string): void => {
    void window.vav.window.openFilePreview(path)
  }

  const refreshParent = (path: string): void => {
    void loadDirectory(activeId, dirname(path))
  }

  const toggleViewMode = (): void => {
    const next: FileViewMode = viewMode === 'tree' ? 'column' : 'tree'
    void updateSettings({ fileViewMode: next })
  }

  return (
    <>
      <div className="files-toolbar">
        <Button
          label={sortButtonLabel(normalizeFileSortKey(workspace.sort), t)}
          icon={<ArrowUpDown size={12} />}
          size="sm"
          onClick={(event) =>
            void showMenu(sortItems, menuAnchor(event.currentTarget as HTMLElement))
          }
        />
        <Button
          icon={<Plus size={13} />}
          size="sm"
          title={t('files.newSessionHere')}
          onClick={() => void createConversationInCurrentWorkspace()}
        />
        <Button
          icon={viewMode === 'tree' ? <List size={13} /> : <Columns3 size={13} />}
          size="sm"
          title={viewMode === 'tree' ? t('files.viewList') : t('files.viewColumn')}
          onClick={toggleViewMode}
        />
        {temporary && (
          <Button
            icon={<FolderSync size={13} />}
            size="sm"
            title={t('files.moveTo')}
            onClick={() => void locateWorkspace(activeId)}
          />
        )}
        <Button
          icon={<Info size={13} />}
          size="sm"
          title={t('ui.ignoredPaths', {
            list: [...IGNORED_NAMES, ...IGNORED_SUFFIXES].join('\n')
          })}
        />
      </div>

      {changed.length > 0 && (
        <div className="changed-strip">
          <Pencil size={11} />
          <span className="tiny">{t('files.changedThisSession')}</span>
          {changed.map((path) => (
            <button
              key={path}
              className="chip"
              title={path}
              onClick={() => selectPath(activeId, path)}
            >
              <span className="chip-label">{basename(path)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="files-browser" data-opaque={browserOpaque || undefined}>
        {displayMode === 'tree' ? (
          <div className="file-tree" onClick={() => selectPath(activeId, null)}>
            {rootError ? (
              <InlineAlert kind="error" title={t('files.error.readDir')} message={rootError} />
            ) : (
              <TreeLevel
                path={workspace.root}
                level={0}
                onOpen={openViewer}
                onMutated={refreshParent}
              />
            )}
          </div>
        ) : (
          <ColumnBrowser
            root={workspace.root}
            columnPath={columnPath}
            setColumnPath={setColumnPath}
            onOpen={openViewer}
            onMutated={refreshParent}
          />
        )}
      </div>
    </>
  )
}

function ColumnBrowser({
  root,
  columnPath,
  setColumnPath,
  onOpen,
  onMutated
}: {
  root: string
  columnPath: string[]
  setColumnPath: (paths: string[]) => void
  onOpen: (path: string) => void
  onMutated: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const loadDirectory = useWorkspaceStore((s) => s.loadDirectory)
  const selectPath = useWorkspaceStore((s) => s.selectPath)
  const columns = [root, ...columnPath]

  useEffect(() => {
    for (const dir of columns) {
      if (workspace && !workspace.dirs[dir] && !workspace.loadingDirs.includes(dir)) {
        void loadDirectory(activeId, dir)
      }
    }
  }, [activeId, columns.join('\0'), workspace, loadDirectory])

  const columnsRef = useRef<HTMLDivElement>(null)

  // After a folder expands a new column, jump to the end so it is fully visible.
  useEffect(() => {
    const el = columnsRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [columnPath.length])

  /** Clear selection and collapse drilled-in columns back to the root pane. */
  const clearSelection = (): void => {
    selectPath(activeId, null)
    setColumnPath([])
  }

  return (
    <div className="file-columns" ref={columnsRef} onClick={clearSelection}>
      {columns.map((dir, index) => {
        const entries = workspace?.dirs[dir] ?? []
        const error = workspace?.dirErrors[dir]
        const loading = workspace?.loadingDirs.includes(dir)
        return (
          <div className="file-column" key={`${dir}-${index}`} onClick={clearSelection}>
            {error && <InlineAlert kind="error" title={t('files.readError')} message={error} />}
            {loading && !workspace?.dirs[dir] && (
              <div className="muted tiny" style={{ padding: 8 }}>
                {tt('common.loading')}
              </div>
            )}
            {!error &&
              entries.map((entry) => {
                const selected = workspace?.selectedPath === entry.path
                const open = columnPath[index] === entry.path
                return (
                  <div
                    key={entry.path}
                    className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}${open && !selected ? ' open' : ''}`}
                    title={entry.path}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectPath(activeId, entry.path)
                      if (entry.isDirectory) {
                        setColumnPath([...columnPath.slice(0, index), entry.path])
                      } else {
                        setColumnPath(columnPath.slice(0, index))
                      }
                    }}
                    onDoubleClick={() => {
                      if (!entry.isDirectory) onOpen(entry.path)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      selectPath(activeId, entry.path)
                      void showEntryMenu(entry, {
                        onOpen,
                        onMutated,
                        onRename: () => {
                          const next = window.prompt(t('files.renamePrompt'), entry.name)
                          if (!next || next === entry.name) return
                          void window.vav.files.rename(entry.path, next.trim()).then((result) => {
                            if (result.ok) onMutated(entry.path)
                          })
                        },
                        expandAll: entry.isDirectory
                          ? () => void expandAll(activeId, entry.path)
                          : undefined,
                        collapseAll: entry.isDirectory
                          ? () => collapseAll(activeId, entry.path)
                          : undefined
                      })
                    }}
                  >
                    {entry.isDirectory ? <Folder size={13} /> : <FileIcon size={13} />}
                    <span className="tree-name">{entry.name}</span>
                    {entry.isDirectory && <ChevronRight size={11} className="column-chevron" />}
                  </div>
                )
              })}
            {!error && !loading && entries.length === 0 && workspace?.dirs[dir] && (
              <div className="muted tiny" style={{ padding: 8 }}>
                {tt('files.emptyFolder')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TreeLevel({
  path,
  level,
  onOpen,
  onMutated
}: {
  path: string
  level: number
  onOpen: (path: string) => void
  onMutated: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const entries = workspace?.dirs[path]
  const loading = workspace?.loadingDirs.includes(path)
  const error = workspace?.dirErrors[path]
  const truncated = workspace?.dirTruncated[path] ?? 0

  if (error) {
    return (
      <div style={{ paddingLeft: level * 14 + 6 }}>
        <InlineAlert kind="error" title={t('files.error.readDir')} message={error} />
      </div>
    )
  }

  if (loading && !entries) {
    return (
      <div>
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton-row" key={index} style={{ marginLeft: level * 14 + 20 }} />
        ))}
      </div>
    )
  }

  if (!entries) return <></>

  if (entries.length === 0) {
    return (
      <div
        className="muted tiny"
        style={{ paddingLeft: level * 14 + 22, height: 24, lineHeight: '24px' }}
      >
        {tt('files.emptyFolder')}
      </div>
    )
  }

  return (
    <>
      {entries.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          level={level}
          onOpen={onOpen}
          onMutated={onMutated}
        />
      ))}
      {truncated > 0 && (
        <div
          className="muted tiny"
          style={{ paddingLeft: level * 14 + 22, height: 24, lineHeight: '24px' }}
        >
          {tt('files.moreTruncated', { n: truncated })}
        </div>
      )}
    </>
  )
}

function TreeRow({
  entry,
  level,
  onOpen,
  onMutated
}: {
  entry: FileEntry
  level: number
  onOpen: (path: string) => void
  onMutated: (path: string) => void
}): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const expanded = useWorkspaceStore((s) => s.workspaces[activeId]?.expanded.includes(entry.path))
  const selected = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath === entry.path)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const selectPath = useWorkspaceStore((s) => s.selectPath)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(entry.name)

  return (
    <>
      <div
        className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}`}
        style={{ paddingLeft: level * 14 + 10 }}
        title={entry.path}
        onClick={(event) => {
          event.stopPropagation()
          selectPath(activeId, entry.path)
          if (entry.isDirectory) void toggleExpand(activeId, entry.path)
        }}
        onDoubleClick={() => {
          if (!entry.isDirectory) onOpen(entry.path)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          selectPath(activeId, entry.path)
          void showEntryMenu(entry, {
            onOpen,
            onMutated,
            onRename: () => {
              setDraft(entry.name)
              setRenaming(true)
            },
            expandAll: entry.isDirectory
              ? () => void expandAll(activeId, entry.path)
              : undefined,
            collapseAll: entry.isDirectory
              ? () => collapseAll(activeId, entry.path)
              : undefined
          })
        }}
      >
        <span className="disclosure">
          {entry.isDirectory ? (
            expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : null}
        </span>
        {entry.isDirectory ? <Folder size={13} /> : <FileIcon size={13} />}
        {renaming ? (
          <input
            className="text-field rename-field"
            autoFocus
            value={draft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setRenaming(false)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                void (async () => {
                  const result = await window.vav.files.rename(entry.path, draft.trim())
                  setRenaming(false)
                  if (result.ok) onMutated(entry.path)
                })()
              }
            }}
          />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
        {!entry.isDirectory && <span className="tree-size">{formatBytes(entry.size)}</span>}
      </div>
      {entry.isDirectory && expanded && (
        <TreeLevel path={entry.path} level={level + 1} onOpen={onOpen} onMutated={onMutated} />
      )}
    </>
  )
}

async function showEntryMenu(
  entry: FileEntry,
  options: {
    onOpen: (path: string) => void
    onMutated: (path: string) => void
    onRename?: () => void
    expandAll?: () => void
    collapseAll?: () => void
  }
): Promise<void> {
  const items: MenuItem[] = entry.isDirectory
    ? [
        ...(options.expandAll
          ? [{ label: tt('common.expandAll'), onSelect: options.expandAll }]
          : []),
        ...(options.collapseAll
          ? [{ label: tt('common.collapseAll'), onSelect: options.collapseAll }]
          : []),
        { label: '', divider: true },
        {
          label: tt('files.copyPath'),
          onSelect: () => void window.vav.conversations.copyToClipboard(entry.path)
        },
        {
          label: tt('files.reveal', { fileManager: fileManagerLabel() }),
          onSelect: () => void window.vav.conversations.revealInFinder(entry.path)
        },
        ...(options.onRename
          ? [{ label: tt('common.rename'), onSelect: options.onRename }]
          : []),
        {
          label: tt('files.delete'),
          onSelect: () => void confirmTrash([entry.path], options.onMutated)
        }
      ]
    : [
        { label: tt('files.open'), onSelect: () => options.onOpen(entry.path) },
        {
          label: tt('files.quickLook'),
          onSelect: () => void window.vav.files.quickLook(entry.path)
        },
        { label: '', divider: true },
        {
          label: tt('files.copyPath'),
          onSelect: () => void window.vav.conversations.copyToClipboard(entry.path)
        },
        {
          label: tt('files.reveal', { fileManager: fileManagerLabel() }),
          onSelect: () => void window.vav.conversations.revealInFinder(entry.path)
        },
        {
          label: tt('common.copy'),
          onSelect: () =>
            void window.vav.files.read(entry.path).then((result) => {
              if (result.content) void window.vav.conversations.copyToClipboard(result.content)
            })
        },
        ...(options.onRename
          ? [{ label: tt('common.rename'), onSelect: options.onRename }]
          : []),
        {
          label: tt('files.delete'),
          onSelect: () => void confirmTrash([entry.path], options.onMutated)
        }
      ]

  await showMenu(items)
}

async function confirmTrash(
  paths: string[],
  onMutated: (path: string) => void
): Promise<void> {
  const label =
    paths.length === 1 ? basename(paths[0]) : tt('files.items', { n: paths.length })
  const ok = window.confirm(tt('files.deleteConfirm', { label }))
  if (!ok) return
  const result = await window.vav.files.trash(paths)
  if (result.ok) onMutated(paths[0])
}

async function expandAll(conversationId: string, path: string): Promise<void> {
  await useWorkspaceStore.getState().loadDirectory(conversationId, path)
  const slice = useWorkspaceStore.getState().workspaces[conversationId]
  if (!slice) return
  if (!slice.expanded.includes(path)) {
    useWorkspaceStore.setState({
      workspaces: {
        ...useWorkspaceStore.getState().workspaces,
        [conversationId]: { ...slice, expanded: [...slice.expanded, path] }
      }
    })
  }
  const entries = useWorkspaceStore.getState().workspaces[conversationId]?.dirs[path] ?? []
  for (const entry of entries) {
    if (entry.isDirectory) await expandAll(conversationId, entry.path)
  }
}

function collapseAll(conversationId: string, path: string): void {
  const store = useWorkspaceStore.getState()
  const slice = store.workspaces[conversationId]
  if (!slice) return
  const prefix = path.endsWith('/') ? path : `${path}/`
  const next = slice.expanded.filter((p) => p !== path && !p.startsWith(prefix))
  useWorkspaceStore.setState({
    workspaces: {
      ...store.workspaces,
      [conversationId]: { ...slice, expanded: next }
    }
  })
}
