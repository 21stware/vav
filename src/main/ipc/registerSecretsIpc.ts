import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'

export type SecretsIpcStore = {
  status: () => unknown
  unlock: () => { ok: boolean } & Record<string, unknown>
}

/** Keychain / secrets-file unlock. Analysis warm happens in the entry. */
export function registerSecretsIpc(
  ipcMain: IpcMain,
  store: SecretsIpcStore,
  onUnlocked: () => void
): void {
  ipcMain.handle(IPC.secretsStatus, () => store.status())
  ipcMain.handle(IPC.secretsUnlock, () => {
    const result = store.unlock()
    if (result.ok) onUnlocked()
    return result
  })
}
