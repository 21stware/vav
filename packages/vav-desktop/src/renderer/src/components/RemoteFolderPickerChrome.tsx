import { useEffect, useState } from 'react'
import { Columns3, House, List } from 'lucide-react'
import type { FileEntry, FileViewMode } from '@shared/types'
import type { MessageKey, TParams } from '@shared/i18n'
import type { WorkspaceRef } from '@shared/workspaceHost'
import { basename, dirname } from '../lib/path'
import { canGoParent, confirmFolderPath } from '../lib/remoteFolderPick'
import { Button, Modal } from './ui'
import { FilePickBrowser, type FilePickDirs } from './filesPanel/FilePickBrowser'

type TFn = (key: MessageKey, params?: TParams) => string

/** Shared remote-folder browser: in-app overlay or native modal window. */
export function RemoteFolderPickerChrome({
  variant,
  machineId,
  hostName,
  recents,
  homeSeed,
  fileViewMode,
  t,
  onCancel,
  onConfirm
}: {
  variant: 'overlay' | 'window'
  machineId: string
  hostName: string
  recents: WorkspaceRef[]
  homeSeed: string
  fileViewMode: FileViewMode
  t: TFn
  onCancel: () => void
  onConfirm: (path: string) => void
}): React.JSX.Element {
  const [path, setPath] = useState(homeSeed)
  const [home, setHome] = useState(homeSeed)
  const [dirs, setDirs] = useState<FilePickDirs>({})
  const [loadingDirs, setLoadingDirs] = useState<string[]>([])
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [columnPath, setColumnPath] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<FileViewMode>(fileViewMode)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    const applyHome = (next: string): void => {
      if (!alive || !next) return
      setHome(next)
      setPath(next)
      setSelected(null)
      setExpanded([])
      setColumnPath([])
      setFilter('')
      setDirs({})
      setDirErrors({})
    }
    if (homeSeed) {
      applyHome(homeSeed)
      return () => {
        alive = false
      }
    }
    void window.vav.hosts.home(machineId).then((value) => {
      applyHome(value)
    })
    return () => {
      alive = false
    }
  }, [machineId, homeSeed])

  useEffect(() => {
    if (!path) return
    let alive = true
    setLoadingDirs((current) => (current.includes(path) ? current : [...current, path]))
    void window.vav.hosts.listDir(machineId, path).then((listing) => {
      if (!alive) return
      setLoadingDirs((current) => current.filter((dir) => dir !== path))
      setDirErrors((current) => {
        const next = { ...current }
        if (listing.error) next[path] = listing.error
        else delete next[path]
        return next
      })
      setDirs((current) => ({ ...current, [path]: listing.entries }))
    })
    return () => {
      alive = false
    }
  }, [machineId, path])

  const columnsKey = columnPath.join('\0')
  useEffect(() => {
    if (columnPath.length === 0) return
    let alive = true
    for (const dir of columnPath) {
      setLoadingDirs((current) => (current.includes(dir) ? current : [...current, dir]))
      void window.vav.hosts.listDir(machineId, dir).then((listing) => {
        if (!alive) return
        setLoadingDirs((current) => current.filter((item) => item !== dir))
        setDirErrors((current) => {
          const next = { ...current }
          if (listing.error) next[dir] = listing.error
          else delete next[dir]
          return next
        })
        setDirs((current) => ({ ...current, [dir]: listing.entries }))
      })
    }
    return () => {
      alive = false
    }
    // columnsKey is the stable listing of columnPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, columnsKey])

  const loadDir = (dir: string): void => {
    if (dirs[dir] || loadingDirs.includes(dir)) return
    setLoadingDirs((current) => [...current, dir])
    void window.vav.hosts.listDir(machineId, dir).then((listing) => {
      setLoadingDirs((current) => current.filter((item) => item !== dir))
      setDirErrors((current) => {
        const next = { ...current }
        if (listing.error) next[dir] = listing.error
        else delete next[dir]
        return next
      })
      setDirs((current) => ({ ...current, [dir]: listing.entries }))
    })
  }

  const enterDir = (next: string): void => {
    setPath(next)
    setSelected(null)
    setExpanded([])
    setColumnPath([])
    setFilter('')
  }

  const toggleExpand = (dir: string): void => {
    setExpanded((current) => {
      if (current.includes(dir)) return current.filter((item) => item !== dir)
      return [...current, dir]
    })
    loadDir(dir)
  }

  const chosen = confirmFolderPath(path, selected)
  const title = t('hosts.pickTitle', { name: hostName })
  const selectButton = (
    <Button
      label={t('hosts.pickSelect')}
      variant="primary"
      testId="remote-folder-select"
      onClick={() => onConfirm(chosen)}
    />
  )

  const body = (
    <div className="remote-folder-picker" data-testid="remote-folder-picker">
      <div className="remote-folder-toolbar">
        <Button
          icon={<House size={14} />}
          size="sm"
          title={t('hosts.pickHome')}
          testId="remote-folder-home"
          disabled={!home || path === home}
          onClick={() => enterDir(home)}
        />
        <Button
          label={t('hosts.pickParent')}
          size="sm"
          testId="remote-folder-parent"
          disabled={!canGoParent(path)}
          onClick={() => enterDir(dirname(path))}
        />
        <Button
          icon={viewMode === 'tree' ? <List size={14} /> : <Columns3 size={14} />}
          size="sm"
          title={viewMode === 'tree' ? t('files.viewList') : t('files.viewColumn')}
          testId="remote-folder-view-mode"
          onClick={() => setViewMode((mode) => (mode === 'tree' ? 'column' : 'tree'))}
        />
        <input
          className="text-field remote-folder-filter"
          value={filter}
          placeholder={t('common.search')}
          spellCheck={false}
          data-testid="remote-folder-filter"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="remote-folder-path">
        <input
          className="text-field"
          value={path}
          onChange={(event) => {
            setPath(event.target.value)
            setSelected(null)
            setExpanded([])
            setColumnPath([])
          }}
          spellCheck={false}
          data-testid="remote-folder-path"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onConfirm(confirmFolderPath(path, selected))
            }
          }}
        />
      </div>
      {recents.length > 0 && (
        <div className="remote-folder-recents" data-testid="remote-folder-recents">
          <div className="form-hint">{t('hosts.pickRecents')}</div>
          <div className="remote-folder-recent-chips">
            {recents.slice(0, 5).map((ref) => (
              <button
                key={`${ref.machineId}:${ref.path}`}
                type="button"
                className="remote-folder-chip"
                onClick={() => enterDir(ref.path)}
              >
                {basename(ref.path)}
              </button>
            ))}
          </div>
        </div>
      )}
      <FilePickBrowser
        root={path}
        dirs={dirs}
        loadingDirs={loadingDirs}
        dirErrors={dirErrors}
        selectedPath={selected?.path ?? null}
        expanded={expanded}
        viewMode={viewMode}
        columnPath={columnPath}
        filter={filter}
        onSelect={setSelected}
        onToggleExpand={toggleExpand}
        onEnterDir={enterDir}
        onColumnPath={setColumnPath}
      />
    </div>
  )

  if (variant === 'overlay') {
    return (
      <Modal
        title={title}
        size="wide"
        onDismiss={onCancel}
        actions={(dismiss) => (
          <>
            <Button label={t('common.cancel')} onClick={() => dismiss()} />
            {selectButton}
          </>
        )}
      >
        {body}
      </Modal>
    )
  }

  return (
    <div className="remote-folder-window" data-testid="remote-folder-window">
      <header className="remote-folder-head">{title}</header>
      <div className="remote-folder-body">{body}</div>
      <footer className="remote-folder-actions">
        <Button label={t('common.cancel')} onClick={onCancel} />
        {selectButton}
      </footer>
    </div>
  )
}
