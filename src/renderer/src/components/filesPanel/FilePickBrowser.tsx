import { ChevronDown, ChevronRight, File as FileIcon, Folder } from 'lucide-react'
import type { FileEntry, FileViewMode } from '@shared/types'
import { useT, tt } from '../../i18n/useT'
import { filterFileEntries } from '../../lib/remoteFolderPick'
import { InlineAlert } from '../ui'

export type FilePickDirs = Record<string, FileEntry[]>

/**
 * Presentational Files-panel browser for a standalone picker.
 * Same tree / column chrome as {@link FilesPanel} — no session workspace store.
 */
export function FilePickBrowser({
  root,
  dirs,
  loadingDirs,
  dirErrors,
  selectedPath,
  expanded,
  viewMode,
  columnPath,
  filter,
  onSelect,
  onToggleExpand,
  onEnterDir,
  onColumnPath
}: {
  root: string
  dirs: FilePickDirs
  loadingDirs: string[]
  dirErrors: Record<string, string>
  selectedPath: string | null
  expanded: string[]
  viewMode: FileViewMode
  columnPath: string[]
  filter: string
  onSelect: (entry: FileEntry | null) => void
  onToggleExpand: (path: string) => void
  onEnterDir: (path: string) => void
  onColumnPath: (next: string[]) => void
}): React.JSX.Element {
  const t = useT()
  const rootError = dirErrors[root]
  const rootLoading = loadingDirs.includes(root) && !dirs[root]

  return (
    <div className="files-browser" data-opaque="" role="tree" aria-label={t('tools.files')}>
      {rootError ? (
        <div data-testid="remote-folder-error">
          <InlineAlert kind="error" title={t('files.readError')} message={rootError} />
        </div>
      ) : rootLoading ? (
        <div className="muted tiny" style={{ padding: 8 }}>
          {tt('common.loading')}
        </div>
      ) : viewMode === 'tree' ? (
        <div className="file-tree" onClick={() => onSelect(null)}>
          <PickTreeLevel
            path={root}
            level={0}
            dirs={dirs}
            loadingDirs={loadingDirs}
            dirErrors={dirErrors}
            selectedPath={selectedPath}
            expanded={expanded}
            filter={filter}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onEnterDir={onEnterDir}
          />
        </div>
      ) : (
        <PickColumnBrowser
          root={root}
          dirs={dirs}
          loadingDirs={loadingDirs}
          dirErrors={dirErrors}
          selectedPath={selectedPath}
          columnPath={columnPath}
          filter={filter}
          onSelect={onSelect}
          onEnterDir={onEnterDir}
          onColumnPath={onColumnPath}
        />
      )}
    </div>
  )
}

function PickTreeLevel({
  path,
  level,
  dirs,
  loadingDirs,
  dirErrors,
  selectedPath,
  expanded,
  filter,
  onSelect,
  onToggleExpand,
  onEnterDir
}: {
  path: string
  level: number
  dirs: FilePickDirs
  loadingDirs: string[]
  dirErrors: Record<string, string>
  selectedPath: string | null
  expanded: string[]
  filter: string
  onSelect: (entry: FileEntry | null) => void
  onToggleExpand: (path: string) => void
  onEnterDir: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const error = dirErrors[path]
  const loading = loadingDirs.includes(path)
  const entries = filterFileEntries(dirs[path] ?? [], level === 0 ? filter : '')

  if (error) {
    return (
      <div style={{ paddingLeft: level * 14 + 6 }}>
        <InlineAlert kind="error" title={t('files.readError')} message={error} />
      </div>
    )
  }

  if (loading && !dirs[path]) {
    return (
      <div>
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton-row" key={index} style={{ marginLeft: level * 14 + 20 }} />
        ))}
      </div>
    )
  }

  if (!dirs[path]) return <></>

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
        <PickTreeRow
          key={entry.path}
          entry={entry}
          level={level}
          dirs={dirs}
          loadingDirs={loadingDirs}
          dirErrors={dirErrors}
          selectedPath={selectedPath}
          expanded={expanded}
          filter={filter}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onEnterDir={onEnterDir}
        />
      ))}
    </>
  )
}

function PickTreeRow({
  entry,
  level,
  dirs,
  loadingDirs,
  dirErrors,
  selectedPath,
  expanded,
  filter,
  onSelect,
  onToggleExpand,
  onEnterDir
}: {
  entry: FileEntry
  level: number
  dirs: FilePickDirs
  loadingDirs: string[]
  dirErrors: Record<string, string>
  selectedPath: string | null
  expanded: string[]
  filter: string
  onSelect: (entry: FileEntry | null) => void
  onToggleExpand: (path: string) => void
  onEnterDir: (path: string) => void
}): React.JSX.Element {
  const open = expanded.includes(entry.path)
  const selected = selectedPath === entry.path

  return (
    <>
      <div
        className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}`}
        data-file-path={entry.path}
        data-testid={`remote-folder-entry-${entry.name}`}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={entry.isDirectory ? open : undefined}
        style={{ paddingLeft: level * 14 + 10 }}
        title={entry.path}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(entry)
          if (entry.isDirectory) onToggleExpand(entry.path)
        }}
        onDoubleClick={() => {
          if (entry.isDirectory) onEnterDir(entry.path)
        }}
      >
        <span className="disclosure" aria-hidden>
          {entry.isDirectory ? (
            open ? (
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
        <span className="tree-name">{entry.name}</span>
      </div>
      {entry.isDirectory && open && (
        <PickTreeLevel
          path={entry.path}
          level={level + 1}
          dirs={dirs}
          loadingDirs={loadingDirs}
          dirErrors={dirErrors}
          selectedPath={selectedPath}
          expanded={expanded}
          filter={filter}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onEnterDir={onEnterDir}
        />
      )}
    </>
  )
}

function PickColumnBrowser({
  root,
  dirs,
  loadingDirs,
  dirErrors,
  selectedPath,
  columnPath,
  filter,
  onSelect,
  onEnterDir,
  onColumnPath
}: {
  root: string
  dirs: FilePickDirs
  loadingDirs: string[]
  dirErrors: Record<string, string>
  selectedPath: string | null
  columnPath: string[]
  filter: string
  onSelect: (entry: FileEntry | null) => void
  onEnterDir: (path: string) => void
  onColumnPath: (next: string[]) => void
}): React.JSX.Element {
  const t = useT()
  const columns = [root, ...columnPath]

  return (
    <div className="file-columns">
      {columns.map((dir, index) => {
        const entries = filterFileEntries(dirs[dir] ?? [], index === 0 ? filter : '')
        const error = dirErrors[dir]
        const loading = loadingDirs.includes(dir) && !dirs[dir]
        return (
          <div
            className="file-column"
            key={`${dir}-${index}`}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(null)
              onColumnPath(columnPath.slice(0, index))
            }}
          >
            {error && <InlineAlert kind="error" title={t('files.readError')} message={error} />}
            {loading && (
              <div className="muted tiny" style={{ padding: 8 }}>
                {tt('common.loading')}
              </div>
            )}
            {!error &&
              entries.map((entry) => {
                const selected = selectedPath === entry.path
                const open = columnPath[index] === entry.path
                return (
                  <div
                    key={entry.path}
                    data-file-path={entry.path}
                    data-testid={`remote-folder-entry-${entry.name}`}
                    role="treeitem"
                    aria-selected={selected}
                    className={`tree-row ${entry.isDirectory ? 'dir' : 'file'}${selected ? ' selected' : ''}${open && !selected ? ' open' : ''}`}
                    title={entry.path}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelect(entry)
                      if (entry.isDirectory) {
                        onColumnPath([...columnPath.slice(0, index), entry.path])
                      } else {
                        onColumnPath(columnPath.slice(0, index))
                      }
                    }}
                    onDoubleClick={() => {
                      if (entry.isDirectory) onEnterDir(entry.path)
                    }}
                  >
                    {entry.isDirectory ? (
                      <Folder size={16} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <FileIcon size={16} strokeWidth={1.75} aria-hidden />
                    )}
                    <span className="tree-name">{entry.name}</span>
                    {entry.isDirectory && (
                      <ChevronRight
                        size={14}
                        strokeWidth={1.75}
                        className="column-chevron"
                        aria-hidden
                      />
                    )}
                  </div>
                )
              })}
            {!error && !loading && dirs[dir] && entries.length === 0 && (
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
