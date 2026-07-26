import { useEffect } from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  Pencil
} from 'lucide-react'
import type { FileEntry, FileSortKey } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { formatBytes } from '../lib/format'
import { basename } from '../lib/path'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { Button, EmptyState, InlineAlert } from './ui'

const SORT_LABEL: Record<FileSortKey, string> = {
  name: '名称',
  date: '日期',
  size: '大小',
  kind: '种类'
}

/**
 * Files segment of the tools panel.
 *
 * Directories load one level at a time and only when expanded; ignored names
 * never appear, and oversized directories report the remainder instead of
 * rendering thousands of rows (files-panel.rpml annotation 4).
 */
export function FilesPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)
  const setSort = useWorkspaceStore((s) => s.setSort)
  const selectPath = useWorkspaceStore((s) => s.selectPath)
  const quickLook = useWorkspaceStore((s) => s.quickLook)

  // Only load when the segment is actually on screen.
  useEffect(() => {
    if (visible && activeId) void ensureFilesLoaded(activeId)
  }, [visible, activeId, ensureFilesLoaded])

  // Space triggers Quick Look for the selected file.
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
    return <EmptyState title="未设置工作目录" description="点击路径 chip 选择一个目录。" />
  }

  const rootError = workspace.dirErrors[workspace.root]
  const changed = workspace.changedFiles

  const sortItems: MenuItem[] = (Object.keys(SORT_LABEL) as FileSortKey[]).flatMap((key) => [
    {
      label: `${SORT_LABEL[key]} ↑`,
      checked: workspace.sort === key && workspace.ascending,
      onSelect: () => void setSort(activeId, key, true)
    },
    {
      label: `${SORT_LABEL[key]} ↓`,
      checked: workspace.sort === key && !workspace.ascending,
      onSelect: () => void setSort(activeId, key, false)
    }
  ])

  return (
    <>
      <div className="files-toolbar">
        <Button
          label={`${SORT_LABEL[workspace.sort]} ${workspace.ascending ? '↑' : '↓'}`}
          icon={<ArrowUpDown size={12} />}
          size="sm"
          onClick={(event) =>
            void showMenu(sortItems, menuAnchor(event.currentTarget as HTMLElement))
          }
        />
        <span className="muted tiny">忽略 .git · node_modules · .DS_Store</span>
      </div>

      {changed.length > 0 && (
        <div className="changed-strip">
          <Pencil size={11} />
          <span className="tiny">本次改动</span>
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

      <div className="file-tree">
        {rootError ? (
          <InlineAlert kind="error" title="无法读取目录" message={rootError} />
        ) : (
          <TreeLevel path={workspace.root} level={0} />
        )}
      </div>
    </>
  )
}

function TreeLevel({ path, level }: { path: string; level: number }): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const entries = workspace?.dirs[path]
  const loading = workspace?.loadingDirs.includes(path)
  const error = workspace?.dirErrors[path]
  const truncated = workspace?.dirTruncated[path] ?? 0

  if (error) {
    return (
      <div style={{ paddingLeft: level * 14 + 6 }}>
        <InlineAlert kind="error" title="无法读取目录" message={error} />
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
      <div className="muted tiny" style={{ paddingLeft: level * 14 + 22, height: 24, lineHeight: '24px' }}>
        空文件夹
      </div>
    )
  }

  return (
    <>
      {entries.map((entry) => (
        <TreeRow key={entry.path} entry={entry} level={level} />
      ))}
      {truncated > 0 && (
        <div
          className="muted tiny"
          style={{ paddingLeft: level * 14 + 22, height: 24, lineHeight: '24px' }}
        >
          … {truncated} more
        </div>
      )}
    </>
  )
}

function TreeRow({ entry, level }: { entry: FileEntry; level: number }): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const expanded = useWorkspaceStore((s) => s.workspaces[activeId]?.expanded.includes(entry.path))
  const selected = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath === entry.path)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const selectPath = useWorkspaceStore((s) => s.selectPath)

  return (
    <>
      <div
        className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}`}
        style={{ paddingLeft: level * 14 + 6 }}
        title={entry.path}
        onClick={() => {
          selectPath(activeId, entry.path)
          if (entry.isDirectory) void toggleExpand(activeId, entry.path)
        }}
        onDoubleClick={() => {
          if (!entry.isDirectory) void window.vav.files.quickLook(entry.path)
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
        <span className="tree-name">{entry.name}</span>
        {!entry.isDirectory && <span className="tree-size">{formatBytes(entry.size)}</span>}
      </div>
      {entry.isDirectory && expanded && <TreeLevel path={entry.path} level={level + 1} />}
    </>
  )
}
