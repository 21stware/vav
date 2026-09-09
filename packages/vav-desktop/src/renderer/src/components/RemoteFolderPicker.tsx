import { recentsForMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { RemoteFolderPickerChrome } from './RemoteFolderPickerChrome'

/**
 * Folder picker for a remote workspace host — the native dialog only sees
 * this machine's disks. Reuses the Files-panel tree / column browser and
 * always opens on that host's home (`~`).
 *
 * Desktop Electron opens this as a native modal BrowserWindow
 * (`RemoteFolderWindow`). Phone / web keep the in-app overlay.
 */
export function RemoteFolderPicker(): React.JSX.Element | null {
  const t = useT()
  const pick = useSessionStore((s) => s.remoteFolderPick)
  const hosts = useSessionStore((s) => s.hosts)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const closePicker = useSessionStore((s) => s.closeRemoteFolderPicker)
  const applyPick = useSessionStore((s) => s.applyRemoteFolderPick)
  const fileViewMode = useSessionStore((s) => s.settings.fileViewMode ?? 'tree')

  if (!pick) return null

  const host = hosts.find((h) => h.id === pick.machineId)
  const hostName = host?.name ?? pick.machineId
  const recents = recentsForMachine(recentDirs, pick.machineId)

  const cancel = (): void => {
    void applyPick({ ...pick, purpose: pick.purpose ?? 'workdir', path: null })
    closePicker()
  }

  const confirm = async (chosen: string): Promise<void> => {
    closePicker()
    await applyPick({ ...pick, purpose: pick.purpose ?? 'workdir', path: chosen })
  }

  return (
    <RemoteFolderPickerChrome
      key={`${pick.machineId}:${pick.conversationId}:${pick.purpose ?? 'workdir'}`}
      variant="overlay"
      machineId={pick.machineId}
      hostName={hostName}
      recents={recents}
      homeSeed={host?.home || ''}
      fileViewMode={fileViewMode}
      t={t}
      onCancel={cancel}
      onConfirm={(path) => void confirm(path)}
    />
  )
}
