import { useEffect, useState } from 'react'
import { recentsForMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'
import { Button, Modal } from './ui'

/**
 * Folder picker for a remote workspace host — the native dialog only sees
 * this machine's disks.
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
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const machineId = pick?.machineId ?? ''
  const host = hosts.find((h) => h.id === machineId)
  const hostName = host?.name ?? machineId
  const recents = recentsForMachine(recentDirs, machineId)

  useEffect(() => {
    if (!pick) {
      setPath('')
      return
    }
    let alive = true
    setError(null)
    setEntries([])
    const seeded = host?.defaultPath || host?.home || ''
    if (seeded) {
      setPath(seeded)
      return () => {
        alive = false
      }
    }
    void window.vav.hosts.home(pick.machineId).then((home) => {
      if (!alive) return
      setPath((current) => current || home)
    })
    return () => {
      alive = false
    }
  }, [pick, host?.defaultPath, host?.home])

  useEffect(() => {
    if (!pick || !path) return
    let alive = true
    setLoading(true)
    void window.vav.hosts.listDir(pick.machineId, path).then((listing) => {
      if (!alive) return
      setLoading(false)
      setError(listing.error ?? null)
      setEntries(listing.entries.filter((e) => e.isDirectory).map((e) => ({ name: e.name, path: e.path })))
    })
    return () => {
      alive = false
    }
  }, [pick, path])

  if (!pick) return null

  const parent = path.replace(/[/\\]+$/, '').replace(/[/\\][^/\\]+$/, '') || path

  const select = async (dismiss: () => void): Promise<void> => {
    if (pick.purpose === 'locate' && pick.conversationId) {
      await finishLocateWorkspace(pick.conversationId, path)
      dismiss()
      return
    }
    if (!pick.conversationId) {
      await createConversation({
        workingDirectory: path,
        machineId: pick.machineId,
        openIn: 'here'
      })
    } else {
      await setWorkingDirectory(pick.conversationId, path, pick.machineId)
    }
    dismiss()
  }

  return (
    <Modal
      title={t('hosts.pickTitle', { name: hostName })}
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
        <div className="remote-folder-path">
          <input
            className="text-field"
            value={path}
            onChange={(event) => setPath(event.target.value)}
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
                onClick={() => setPath(ref.path)}
              >
                {basename(ref.path)}
              </button>
            ))}
          </div>
        )}
        {path !== parent && (
          <button
            type="button"
            className="remote-folder-row"
            data-testid="remote-folder-parent"
            onClick={() => setPath(parent)}
          >
            {t('hosts.pickParent')}
          </button>
        )}
        {loading && <div className="form-hint">{t('common.loading')}</div>}
        {error && (
          <div className="session-workspace-error" data-testid="remote-folder-error">
            {error}
          </div>
        )}
        <div className="remote-folder-list">
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="remote-folder-row"
              data-testid={`remote-folder-entry-${entry.name}`}
              onClick={() => setPath(entry.path)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
