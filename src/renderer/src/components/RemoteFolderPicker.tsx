import { useEffect, useState } from 'react'
import { Columns3, House, List } from 'lucide-react'
import type { FileEntry, FileViewMode } from '@shared/types'
import { recentsForMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { basename, dirname } from '../lib/path'
import { canGoParent, confirmFolderPath } from '../lib/remoteFolderPick'
import { Button, Modal } from './ui'
import { FilePickBrowser, type FilePickDirs } from './filesPanel/FilePickBrowser'

/**
 * Folder picker for a remote workspace host — the native dialog only sees
 * this machine's disks. Reuses the Files-panel tree / column browser and
 * always opens on that host's home (`~`).
 */
export function RemoteFolderPicker(): React.JSX.Element | null {
  const t = useT()
  const pick = useSessionStore((s) => s.remoteFolderPick)
  const hosts = useSessionStore((s) => s.hosts)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const close = useSessionStore((s) => s.closeRemoteFolderPicker)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const createConversation = useSessionStore((s) => s.createConversation)
  const finishLocateWorkspace = useSessionStore((s) => s.finishLocateWorkspace)
  const fileViewMode = useSessionStore((s) => s.settings.fileViewMode ?? 'tree')
  const [path, setPath] = useState('')
  const [home, setHome] = useState('')
  const [dirs, setDirs] = useState<FilePickDirs>({})
  const [loadingDirs, setLoadingDirs] = useState<string[]>([])
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [columnPath, setColumnPath] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<FileViewMode>(fileViewMode)
  const [filter, setFilter] = useState('')

  const machineId = pick?.machineId ?? ''
  const host = hosts.find((h) => h.id === machineId)
  const hostName = host?.name ?? machineId
  const recents = recentsForMachine(recentDirs, machineId)

  useEffect(() => {
    if (!pick) {
      setPath('')
      setHome('')
      setDirs({})
      setLoadingDirs([])
      setDirErrors({})
      setSelected(null)
      setExpanded([])
      setColumnPath([])
      setFilter('')
      return
    }
    let alive = true
    const seeded = host?.home || ''
    const applyHome = (next: string): void => {
      if (!alive || !next) return
      setHome(next)
      setPath(next)
      setSelected(null)
      setExpanded([])
      setColumnPath([])
      setFilter('')
    }
    if (seeded) {
      applyHome(seeded)
      return () => {
        alive = false
      }
    }
    void window.vav.hosts.home(pick.machineId).then((value) => {
      applyHome(value)
    })
    return () => {
      alive = false
    }
  }, [pick, host?.home])

  useEffect(() => {
    if (!pick || !path) return
    let alive = true
    setLoadingDirs((current) => (current.includes(path) ? current : [...current, path]))
    void window.vav.hosts.listDir(pick.machineId, path).then((listing) => {
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
  }, [pick, path])

  const columnsKey = columnPath.join('\0')
  useEffect(() => {
    if (!pick || columnPath.length === 0) return
    let alive = true
    for (const dir of columnPath) {
      setLoadingDirs((current) => (current.includes(dir) ? current : [...current, dir]))
      void window.vav.hosts.listDir(pick.machineId, dir).then((listing) => {
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
  }, [pick, columnsKey])

  if (!pick) return null

  const loadDir = (dir: string): void => {
    if (!pick || dirs[dir] || loadingDirs.includes(dir)) return
    setLoadingDirs((current) => [...current, dir])
    void window.vav.hosts.listDir(pick.machineId, dir).then((listing) => {
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

  const select = async (dismiss: () => void): Promise<void> => {
    const chosen = confirmFolderPath(path, selected)
    if (pick.purpose === 'locate' && pick.conversationId) {
      await finishLocateWorkspace(pick.conversationId, chosen)
      dismiss()
      return
    }
    if (!pick.conversationId) {
      await createConversation({
        workingDirectory: chosen,
        machineId: pick.machineId,
        openIn: 'here'
      })
    } else {
      await setWorkingDirectory(pick.conversationId, chosen, pick.machineId)
    }
    dismiss()
  }

  return (
    <Modal
      title={t('hosts.pickTitle', { name: hostName })}
      size="wide"
      onDismiss={close}
      actions={(dismiss) => (
        <>
          <Button label={t('common.cancel')} onClick={() => dismiss()} />
          <Button
            label={t('hosts.pickSelect')}
            variant="primary"
            testId="remote-folder-select"
            onClick={() => void select(dismiss)}
          />
        </>
      )}
    >
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
          />
        </div>
        {recents.length > 0 && (
          <div className="remote-folder-recents" data-testid="remote-folder-recents">
            <div className="form-hint">{t('hosts.pickRecents')}</div>
            {recents.slice(0, 5).map((ref) => (
              <button
                key={`${ref.machineId}:${ref.path}`}
                type="button"
                className="remote-folder-row"
                onClick={() => enterDir(ref.path)}
              >
                {basename(ref.path)}
              </button>
            ))}
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
    </Modal>
  )
}
