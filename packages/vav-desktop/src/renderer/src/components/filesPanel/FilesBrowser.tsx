import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File as FileIcon, Folder, Plus } from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useWorkspaceStore } from '../../state/workspaceStore'
import { useT, tt } from '../../i18n/useT'
import { basename } from '../../lib/path'
import { formatBytes } from '../../lib/format'
import { addFilesToComposer } from '../../lib/composerAttach'
import { showMenu, type MenuItem } from '../../lib/nativeMenu'
import { fileManagerLabel, IS_MAC } from '../../lib/platform'
import {
  nativeFileDragProps,
  nativeOsFileActionsAvailable
} from '../../lib/nativeFileDrag'
import { setUiFocusScope } from '../../lib/uiFocus'
import { InlineAlert } from '../ui'
import { FolderEmptyState } from './FolderEmpty'
import { prefetchForPath } from '../../lib/prefetchHeavy'
import { openFileInSessionPreview } from '../../lib/openSessionFile'
import { expandedAfterCollapseAll, EXPAND_ALL_MAX_DIRS } from '../../lib/filesPanelExpand'

export type FilesCreateState = { dir: string; name: string }

export type FilesBrowserHandlers = {
  onOpen: (path: string) => void
  onMutated: (path: string) => void
  creating: FilesCreateState | null
  onCreatingChange: (name: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
}

export function ColumnBrowser({
  root,
  columnPath,
  setColumnPath,
  onOpen,
  onMutated,
  creating,
  onCreatingChange,
  onCreateCommit,
  onCreateCancel
}: {
  root: string
  columnPath: string[]
  setColumnPath: (paths: string[]) => void
  onOpen: (path: string) => void
  onMutated: (path: string) => void
  creating: { dir: string; name: string } | null
  onCreatingChange: (name: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const dirs = useWorkspaceStore((s) => s.workspaces[activeId]?.dirs)
  const loadingDirs = useWorkspaceStore((s) => s.workspaces[activeId]?.loadingDirs)
  const dirErrors = useWorkspaceStore((s) => s.workspaces[activeId]?.dirErrors)
  const selectedPath = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath ?? null)
  const loadDirectory = useWorkspaceStore((s) => s.loadDirectory)
  const selectPathRaw = useWorkspaceStore((s) => s.selectPath)
  const selectPath = (id: string, path: string | null, _kind?: 'file' | 'dir' | 'clear'): void => {
    selectPathRaw(id, path)
  }
  const columns = [root, ...columnPath]
  const columnsKey = columns.join('\0')

  useEffect(() => {
    for (const dir of columns) {
      if (dirs && !dirs[dir] && !(loadingDirs ?? []).includes(dir)) {
        void loadDirectory(activeId, dir)
      }
    }
    // Intentionally keyed by path list + whether each dir is present — not the
    // whole workspace (PTY hydrate must not re-kick loads).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, columnsKey, dirs, loadingDirs, loadDirectory])

  const columnsRef = useRef<HTMLDivElement>(null)

  // After a folder expands a new column, jump to the end so it is fully visible.
  useEffect(() => {
    const el = columnsRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [columnPath.length])

  /**
   * Blank click in column `index`: keep navigation context on this column's
   * directory (never null — null would empty-collapse the tools panel), and
   * only drop columns deeper than this one.
   */
  const clearAtColumn = (index: number): void => {
    const dir = columns[index] ?? root
    selectPath(activeId, dir, 'dir')
    setColumnPath(columnPath.slice(0, index))
  }

  return (
    <div className="file-columns" ref={columnsRef}>
      {columns.map((dir, index) => {
        const entries = dirs?.[dir] ?? []
        const error = dirErrors?.[dir]
        const loading = (loadingDirs ?? []).includes(dir)
        return (
          <div
            className="file-column"
            key={`${dir}-${index}`}
            onClick={(event) => {
              event.stopPropagation()
              clearAtColumn(index)
            }}
          >
            {error &&
              (error === 'ENOENT' || /enoent|no such file|not found/i.test(error) ? (
                <div className="muted tiny" style={{ padding: 8 }}>
                  {t('sidebar.dirNotExist')}
                </div>
              ) : (
                <InlineAlert kind="error" title={t('files.readError')} message={error} />
              ))}
            {loading && !dirs?.[dir] && (
              <div className="muted tiny" style={{ padding: 8 }}>
                {tt('common.loading')}
              </div>
            )}
            {!error && creating?.dir === dir && (
              <NewFileRow
                level={0}
                name={creating.name}
                onChange={onCreatingChange}
                onCommit={onCreateCommit}
                onCancel={onCreateCancel}
              />
            )}
            {!error && entries.length > 0 && (
              <VirtualColumnRows
                entries={entries}
                dir={dir}
                index={index}
                selectedPath={selectedPath}
                columnPath={columnPath}
                activeId={activeId}
                setColumnPath={setColumnPath}
                selectPath={selectPath}
                onOpen={onOpen}
                onMutated={onMutated}
              />
            )}
            {!error && !loading && entries.length === 0 && dirs?.[dir] && creating?.dir !== dir && (
              <FolderEmptyState />
            )}
          </div>
        )
      })}
    </div>
  )
}

const COLUMN_ROW_PX = 28
const COLUMN_OVERSCAN = 24
const COLUMN_VIRTUALIZE_AFTER = 80

function VirtualColumnRows({
  entries,
  dir,
  index,
  selectedPath,
  columnPath,
  activeId,
  setColumnPath,
  selectPath,
  onOpen,
  onMutated
}: {
  entries: FileEntry[]
  dir: string
  index: number
  selectedPath: string | null
  columnPath: string[]
  activeId: string
  setColumnPath: (next: string[]) => void
  selectPath: (id: string, path: string | null, kind?: 'file' | 'dir' | 'clear') => void
  onOpen: (path: string) => void
  onMutated: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: entries.length })
  const virtualize = entries.length > COLUMN_VIRTUALIZE_AFTER

  const recompute = useCallback(() => {
    const host = hostRef.current?.closest('.file-column') as HTMLElement | null
    if (!host || !virtualize) {
      setRange({ start: 0, end: entries.length })
      return
    }
    const start = Math.max(0, Math.floor(host.scrollTop / COLUMN_ROW_PX) - COLUMN_OVERSCAN)
    const visible = Math.ceil(host.clientHeight / COLUMN_ROW_PX) + COLUMN_OVERSCAN * 2
    const end = Math.min(entries.length, start + Math.max(visible, 1))
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [entries.length, virtualize])

  useLayoutEffect(() => {
    recompute()
    const host = hostRef.current?.closest('.file-column') as HTMLElement | null
    if (!host || !virtualize) return
    host.addEventListener('scroll', recompute, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null
    ro?.observe(host)
    return () => {
      host.removeEventListener('scroll', recompute)
      ro?.disconnect()
    }
  }, [recompute, virtualize])

  const start = virtualize ? range.start : 0
  const end = virtualize ? range.end : entries.length
  const slice = entries.slice(start, end)

  return (
    <div ref={hostRef}>
      {virtualize && start > 0 ? (
        <div style={{ height: start * COLUMN_ROW_PX }} aria-hidden />
      ) : null}
      {slice.map((entry) => {
        const selected = selectedPath === entry.path
        const open = columnPath[index] === entry.path
        return (
          <div
            key={entry.path}
            data-file-path={entry.path}
            role="treeitem"
            aria-selected={selected}
            className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}${open && !selected ? ' open' : ''}`}
            title={entry.path}
            onClick={(event) => {
              event.stopPropagation()
              setUiFocusScope('files')
              if (entry.isDirectory && open) {
                selectPath(activeId, entry.path, 'dir')
                setColumnPath(columnPath.slice(0, index))
                return
              }
              if (!entry.isDirectory && selected) {
                selectPath(activeId, dir, 'dir')
                setColumnPath(columnPath.slice(0, index))
                return
              }
              selectPath(activeId, entry.path, entry.isDirectory ? 'dir' : 'file')
              if (entry.isDirectory) {
                setColumnPath([...columnPath.slice(0, index), entry.path])
              } else {
                setColumnPath(columnPath.slice(0, index))
              }
            }}
            onDoubleClick={() => {
              if (!entry.isDirectory) openFileInSessionPreview(entry.path)
            }}
            {...nativeFileDragProps(entry.path, { isDirectory: entry.isDirectory })}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              selectPath(activeId, entry.path, entry.isDirectory ? 'dir' : 'file')
              void showEntryMenu(entry, {
                onOpen,
                onPreview: () => openFileInSessionPreview(entry.path),
                position: { x: event.clientX, y: event.clientY },
                onMutated,
                onRename: () => {
                  const next = window.prompt(t('files.renamePrompt'), entry.name)
                  if (!next || next === entry.name) return
                  void window.vav.files.rename(entry.path, next.trim(), activeId).then((result) => {
                    if (result.ok) onMutated(entry.path)
                  })
                },
                expandAll: entry.isDirectory ? () => void expandAll(activeId, entry.path) : undefined,
                collapseAll: entry.isDirectory
                  ? () => collapseAll(activeId, entry.path)
                  : undefined
              })
            }}
          >
            {entry.isDirectory ? (
              <Folder size={16} strokeWidth={1.75} aria-hidden />
            ) : (
              <FileIcon size={16} strokeWidth={1.75} aria-hidden />
            )}
            <span className="tree-name">{entry.name}</span>
            {entry.isDirectory && (
              <ChevronRight size={14} strokeWidth={1.75} className="column-chevron" aria-hidden />
            )}
          </div>
        )
      })}
      {virtualize && end < entries.length ? (
        <div style={{ height: (entries.length - end) * COLUMN_ROW_PX }} aria-hidden />
      ) : null}
    </div>
  )
}

export function TreeLevel({
  path,
  level,
  onOpen,
  onMutated,
  creating,
  onCreatingChange,
  onCreateCommit,
  onCreateCancel
}: {
  path: string
  level: number
  onOpen: (path: string) => void
  onMutated: (path: string) => void
  creating: { dir: string; name: string } | null
  onCreatingChange: (name: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  // Narrow subscriptions: PTY layout / tab churn must not re-render every tree level.
  const entries = useWorkspaceStore((s) => s.workspaces[activeId]?.dirs[path])
  const loading = useWorkspaceStore((s) => s.workspaces[activeId]?.loadingDirs.includes(path))
  const error = useWorkspaceStore((s) => s.workspaces[activeId]?.dirErrors[path])
  const truncated = useWorkspaceStore((s) => s.workspaces[activeId]?.dirTruncated[path] ?? 0)
  const showCreate = creating?.dir === path

  if (error) {
    const missing = error === 'ENOENT' || /enoent|no such file|not found/i.test(error)
    if (missing) {
      return (
        <div className="files-missing-nested" style={{ paddingLeft: level * 14 + 6 }}>
          <span className="muted tiny">{t('sidebar.dirNotExist')}</span>
        </div>
      )
    }
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

  if (!entries && !showCreate) return <></>

  const list = entries ?? []

  return (
    <>
      {showCreate && creating && (
        <NewFileRow
          level={level}
          name={creating.name}
          onChange={onCreatingChange}
          onCommit={onCreateCommit}
          onCancel={onCreateCancel}
        />
      )}
      {list.length === 0 && !showCreate && (
        <FolderEmptyState compact={level > 0} padLeft={level > 0 ? level * 14 + 22 : undefined} />
      )}
      {list.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          level={level}
          onOpen={onOpen}
          onMutated={onMutated}
          creating={creating}
          onCreatingChange={onCreatingChange}
          onCreateCommit={onCreateCommit}
          onCreateCancel={onCreateCancel}
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

function NewFileRow({
  level,
  name,
  onChange,
  onCommit,
  onCancel
}: {
  level: number
  name: string
  onChange: (name: string) => void
  onCommit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const settled = useRef(false)
  return (
    <div
      className="tree-row file is-creating"
      data-testid="files-create-row"
      style={{ paddingLeft: level * 14 + 10 }}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="disclosure" aria-hidden />
      <Plus size={16} strokeWidth={1.75} aria-hidden />
      <input
        className="text-field rename-field"
        data-testid="files-create-name"
        autoFocus
        value={name}
        placeholder={t('files.newFilePlaceholder')}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (settled.current) return
          settled.current = true
          onCancel()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            settled.current = true
            onCancel()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            settled.current = true
            onCommit()
          }
        }}
      />
    </div>
  )
}

function TreeRow({
  entry,
  level,
  onOpen,
  onMutated,
  creating,
  onCreatingChange,
  onCreateCommit,
  onCreateCancel
}: {
  entry: FileEntry
  level: number
  onOpen: (path: string) => void
  onMutated: (path: string) => void
  creating: { dir: string; name: string } | null
  onCreatingChange: (name: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
}): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const expanded = useWorkspaceStore((s) => s.workspaces[activeId]?.expanded.includes(entry.path))
  const selected = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath === entry.path)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const selectPathRaw = useWorkspaceStore((s) => s.selectPath)
  const selectEntry = (path: string): void => {
    selectPathRaw(activeId, path)
  }
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(entry.name)

  return (
    <>
      <div
        className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}`}
        data-file-path={entry.path}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={entry.isDirectory ? !!expanded : undefined}
        style={{ paddingLeft: level * 14 + 10 }}
        title={entry.path}
        {...(renaming
          ? { draggable: false as const }
          : nativeFileDragProps(entry.path, { isDirectory: entry.isDirectory }))}
        onMouseEnter={() => {
          if (!entry.isDirectory) prefetchForPath(entry.path)
        }}
        onClick={(event) => {
          event.stopPropagation()
          setUiFocusScope('files')
          if (!entry.isDirectory) prefetchForPath(entry.path)
          selectEntry(entry.path)
          if (entry.isDirectory) void toggleExpand(activeId, entry.path)
        }}
        onDoubleClick={() => {
          if (!entry.isDirectory) openFileInSessionPreview(entry.path)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setUiFocusScope('files')
          selectEntry(entry.path)
          void showEntryMenu(entry, {
            onOpen,
            onPreview: () => openFileInSessionPreview(entry.path),
            position: { x: event.clientX, y: event.clientY },
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
        <span className="disclosure" aria-hidden>
          {entry.isDirectory ? (
            expanded ? (
              <ChevronDown size={14} strokeWidth={1.75} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} />
            )
          ) : null}
        </span>
        {entry.isDirectory ? (
          <Folder size={16} strokeWidth={1.75} aria-hidden />
        ) : (
          <FileIcon size={16} strokeWidth={1.75} aria-hidden />
        )}
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
                  const result = await window.vav.files.rename(
                    entry.path,
                    draft.trim(),
                    activeId
                  )
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
        <TreeLevel
          path={entry.path}
          level={level + 1}
          onOpen={onOpen}
          onMutated={onMutated}
          creating={creating}
          onCreatingChange={onCreatingChange}
          onCreateCommit={onCreateCommit}
          onCreateCancel={onCreateCancel}
        />
      )}
    </>
  )
}

function osFileMenuItems(path: string, opts: { copyContents?: boolean }): MenuItem[] {
  const id = useSessionStore.getState().activeId
  const items: MenuItem[] = []
  if (nativeOsFileActionsAvailable() && typeof window.vav.files.copyAsFile === 'function') {
    items.push({
      label: tt('files.copyFile'),
      onSelect: () => void window.vav.files.copyAsFile([path], id)
    })
  }
  if (opts.copyContents) {
    items.push({
      label: tt('files.copyContents'),
      onSelect: () =>
        void window.vav.files.read(path, id).then((result) => {
          if (result.content) void window.vav.conversations.copyToClipboard(result.content)
        })
    })
  }
  items.push({
    label: tt('files.copyPath'),
    onSelect: () => void window.vav.conversations.copyToClipboard(path)
  })
  items.push({
    label: tt('files.reveal', { fileManager: fileManagerLabel() }),
    onSelect: () => void window.vav.conversations.revealInFinder(path)
  })
  if (nativeOsFileActionsAvailable() && typeof window.vav.files.getInfo === 'function') {
    items.push({
      label: IS_MAC ? tt('files.getInfo') : tt('files.properties'),
      onSelect: () => void window.vav.files.getInfo(path, id)
    })
  }
  return items
}

async function showEntryMenu(
  entry: FileEntry,
  options: {
    onOpen: (path: string) => void
    onPreview?: (path: string) => void
    position?: { x: number; y: number }
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
        ...osFileMenuItems(entry.path, {}),
        ...(options.onRename
          ? [{ label: tt('common.rename'), onSelect: options.onRename }]
          : []),
        {
          label: tt('files.delete'),
          onSelect: () => void confirmTrash([entry.path], options.onMutated)
        }
      ]
    : [
        {
          label: tt('files.addToComposer'),
          onSelect: () => {
            const id = useSessionStore.getState().activeId
            if (!id) return
            addFilesToComposer([entry.path], id)
          }
        },
        { label: '', divider: true },
        ...(options.onPreview
          ? [{ label: tt('common.preview'), onSelect: () => options.onPreview?.(entry.path) }]
          : []),
        { label: tt('files.open'), onSelect: () => options.onOpen(entry.path) },
        {
          label: tt('preview.openWithDefault'),
          onSelect: () => void window.vav.files.openWithDefault(entry.path)
        },
        {
          label: tt('files.quickLook'),
          onSelect: () => void window.vav.files.quickLook(entry.path)
        },
        { label: '', divider: true },
        ...osFileMenuItems(entry.path, { copyContents: true }),
        ...(options.onRename
          ? [{ label: tt('common.rename'), onSelect: options.onRename }]
          : []),
        {
          label: tt('files.delete'),
          onSelect: () => void confirmTrash([entry.path], options.onMutated)
        }
      ]

  await showMenu(items, options.position)
}

async function confirmTrash(
  paths: string[],
  onMutated: (path: string) => void
): Promise<void> {
  const label =
    paths.length === 1 ? basename(paths[0]) : tt('files.items', { n: paths.length })
  const ok = window.confirm(tt('files.deleteConfirm', { label }))
  if (!ok) return
  const result = await window.vav.files.trash(
    paths,
    useSessionStore.getState().activeId
  )
  if (result.ok) onMutated(paths[0])
}

async function expandAll(
  conversationId: string,
  path: string,
  budget = { left: EXPAND_ALL_MAX_DIRS }
): Promise<void> {
  if (budget.left <= 0) return
  budget.left -= 1
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
    if (entry.isDirectory) await expandAll(conversationId, entry.path, budget)
  }
}

function collapseAll(conversationId: string, path: string): void {
  const store = useWorkspaceStore.getState()
  const slice = store.workspaces[conversationId]
  if (!slice) return
  const next = expandedAfterCollapseAll(slice.expanded, path)
  useWorkspaceStore.setState({
    workspaces: {
      ...store.workspaces,
      [conversationId]: { ...slice, expanded: next }
    }
  })
}
