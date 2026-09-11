import { useEffect, useState } from 'react'
import { Columns3, House, List } from 'lucide-react'
import type { FileEntry, FileViewMode } from '@shared/types'
import { normalizeMachineId, recentsForMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { basename, dirname } from '../../lib/path'
import { canGoParent } from '../../lib/remoteFolderPick'
import { openFileSessionFromPath } from '../../lib/openFileSession'
import { Button } from '../ui'
import { FilePickBrowser, type FilePickDirs } from './FilePickBrowser'

/** Last folder per machine so Back to file list restores that host's browse. */
const lastPathByMachine = new Map<string, string>()

/**
 * Workbench Files browser for the active window machine (File category).
 * Same tree / column chrome as the session Files tray; rooted at that host's home.
 */
export function MachineFilesBrowser(): React.JSX.Element {
  const t = useT()
  const machineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const homeSeed = useSessionStore((s) => s.home)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const fileViewMode = useSessionStore((s) => s.settings.fileViewMode ?? 'tree')
  const recents = recentsForMachine(recentDirs, machineId)

  const [path, setPath] = useState(lastPathByMachine.get(machineId) ?? homeSeed)
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
      if (lastPathByMachine.get(machineId)) return
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
  }, [homeSeed, machineId])

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
  }, [path, machineId])

  useEffect(() => {
    if (path) lastPathByMachine.set(machineId, path)
  }, [path, machineId])

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
  }, [columnsKey])

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

  return (
    <div className="remote-folder-picker file-mac-browser" data-testid="file-mac-browser">
      <div className="remote-folder-toolbar">
        <Button
          icon={<House size={14} />}
          size="sm"
          title={t('hosts.pickHome')}
          testId="file-mac-home"
          disabled={!home || path === home}
          onClick={() => enterDir(home)}
        />
        <Button
          label={t('hosts.pickParent')}
          size="sm"
          testId="file-mac-parent"
          disabled={!canGoParent(path)}
          onClick={() => enterDir(dirname(path))}
        />
        <Button
          icon={viewMode === 'tree' ? <List size={14} /> : <Columns3 size={14} />}
          size="sm"
          title={viewMode === 'tree' ? t('files.viewList') : t('files.viewColumn')}
          testId="file-mac-view-mode"
          onClick={() => setViewMode((mode) => (mode === 'tree' ? 'column' : 'tree'))}
        />
        <input
          className="text-field remote-folder-filter"
          value={filter}
          placeholder={t('common.search')}
          spellCheck={false}
          data-testid="file-mac-filter"
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
          data-testid="file-mac-path"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const next = event.currentTarget.value.trim()
              if (next) enterDir(next)
            }
          }}
        />
      </div>
      {recents.length > 0 && (
        <div className="remote-folder-recents" data-testid="file-mac-recents">
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
        onOpenFile={(filePath) => void openFileSessionFromPath(filePath)}
      />
    </div>
  )
}
