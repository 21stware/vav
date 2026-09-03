import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import { IPC, type PtyCreateOptions } from '@shared/ipc'
import { isStructuredCliHost, type ProviderResumeCursor } from '@shared/cliHost'
import type { ShellKind } from '@shared/types'

export type PtyCreateIpcHost = {
  promoteEphemeral: (conversationId: string) => void
  shell: () => ShellKind
  willAttach: (conversationId: string, launch: PtyCreateOptions) => boolean
  prepareLaunch: (
    conversationId: string,
    tabId: string,
    agentId: string,
    args: string[],
    resume?: { cursor: ProviderResumeCursor; title: string | null }
  ) => Promise<{ args: string[] }>
  create: (
    conversationId: string,
    shell: ShellKind,
    cwd: string,
    cols: number,
    rows: number,
    launch: PtyCreateOptions
  ) => string
  afterSpawn: (conversationId: string, tabId: string, agentId: string) => void
}

/** PTY spawn (attach vs swarm-prepare). I/O stays in registerPtyIoIpc. */
export function registerPtyCreateIpc(ipcMain: IpcMain, host: PtyCreateIpcHost): void {
  ipcMain.handle(
    IPC.ptyCreate,
    async (
      _event,
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      options?: PtyCreateOptions | string
    ) => {
      host.promoteEphemeral(conversationId)
      const base: PtyCreateOptions =
        typeof options === 'string' ? { preferredId: options } : { ...(options ?? {}) }
      const agentId = typeof base.agentId === 'string' ? base.agentId : null
      const tabId = base.preferredId || randomUUID()
      let launch = { ...base, preferredId: tabId }
      const attaching = host.willAttach(conversationId, launch)
      if (!attaching && agentId && isStructuredCliHost(agentId)) {
        const planned = await host.prepareLaunch(
          conversationId,
          tabId,
          agentId,
          launch.args ?? [],
          launch.resumeCursor
            ? { cursor: launch.resumeCursor, title: launch.sessionTitle ?? null }
            : undefined
        )
        launch = { ...launch, args: planned.args }
      }
      const id = host.create(conversationId, host.shell(), cwd, cols, rows, launch)
      if (!attaching && agentId && isStructuredCliHost(agentId)) {
        host.afterSpawn(conversationId, id, agentId)
      }
      return id
    }
  )
}
