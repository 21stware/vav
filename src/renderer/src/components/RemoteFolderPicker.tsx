import { useEffect, useState } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { Button, Modal } from './ui'

/**
 * Folder picker for a remote workspace host — the native dialog only sees
 * this machine's disks.
 */
export function RemoteFolderPicker(): React.JSX.Element | null {
  const t = useT()
  const pick = useSessionStore((s) => s.remoteFolderPick)
  const hosts = useSessionStore((s) => s.hosts)
  const close = useSessionStore((s) => s.closeRemoteFolderPicker)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const machineId = pick?.machineId ?? ''
  const hostName = hosts.find((h) => h.id === machineId)?.name ?? machineId

  useEffect(() => {
    if (!pick) return
    let alive = true
    setError(null)
    setEntries([])
    void window.vav.hosts.home(pick.machineId).then((home) => {
      if (!alive) return
      setPath((current) => current || home)
    })
    return () => {
      alive = false
    }
  }, [pick])

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
            onClick={() => {
              void setWorkingDirectory(pick.conversationId, path, pick.machineId)
              dismiss()
            }}
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
