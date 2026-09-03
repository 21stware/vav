import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConversationPtyLayouts } from '@shared/types'

export type PtyIo = {
  write: (tabId: string, data: string) => void
  resize: (tabId: string, cols: number, rows: number, senderId: number, force: boolean) => void
  kill: (tabId: string) => unknown
  isBusy: (tabId: string) => boolean | Promise<boolean>
  listForConversation: (conversationId: string) => unknown
  setLayouts: (conversationId: string, layouts: ConversationPtyLayouts) => void
  replay: (tabId: string) => unknown
  conversationIdFor: (tabId: string) => string | null | undefined
}

/** High-frequency PTY I/O and list/kill — spawn stays in the main entry. */
export function registerPtyIoIpc(
  ipcMain: IpcMain,
  pty: PtyIo,
  swarm: { forgetPane: (conversationId: string, tabId: string) => void }
): void {
  ipcMain.on(IPC.ptyWrite, (_event, tabId: unknown, data: unknown) => {
    if (typeof tabId !== 'string' || typeof data !== 'string') return
    pty.write(tabId, data)
  })
  ipcMain.on(
    IPC.ptyResize,
    (event: { sender: { id: number } }, tabId: unknown, cols: unknown, rows: unknown, force?: unknown) => {
      if (typeof tabId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
      pty.resize(tabId, cols, rows, event.sender.id, force === true)
    }
  )
  ipcMain.handle(IPC.ptyKill, (_event, tabId: string) => {
    const conversationId = pty.conversationIdFor(tabId)
    if (conversationId) swarm.forgetPane(conversationId, tabId)
    return pty.kill(tabId)
  })
  ipcMain.handle(IPC.ptyIsBusy, (_event, tabId: string) => pty.isBusy(tabId))
  ipcMain.handle(IPC.ptyList, (_event, conversationId: string) =>
    pty.listForConversation(String(conversationId || ''))
  )
  ipcMain.handle(
    IPC.ptySetLayouts,
    (_event, conversationId: string, layouts: ConversationPtyLayouts) => {
      pty.setLayouts(String(conversationId || ''), layouts ?? { bash: null, agents: {} })
    }
  )
  ipcMain.handle(IPC.ptyReplay, (_event, tabId: string) => pty.replay(String(tabId || '')))
}
