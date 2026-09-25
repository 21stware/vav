import type { IpcHandleHost } from '../ipc/ipcTrust.ts'

export type ObserveIpcEvent = {
  sender: {
    id: number
    isDestroyed: () => boolean
    getURL: () => string
    mainFrame?: unknown
  }
  senderFrame?: { url?: string } | null
}

export type ObserveIpcRegistry = {
  invoke: (channel: string, args: unknown[], event: ObserveIpcEvent) => Promise<unknown>
  send: (channel: string, args: unknown[], event: ObserveIpcEvent) => void
  channels: () => string[]
}

/**
 * Record raw `ipcMain.handle` / `on` listeners (install after the trust guard
 * so the map stores the unguarded callback). The observe gateway calls these
 * directly — it is not a renderer frame.
 */
export function installObserveIpcRegistry(ipcMain: IpcHandleHost): ObserveIpcRegistry {
  const invokes = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sends = new Map<string, Array<(event: unknown, ...args: unknown[]) => unknown>>()

  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown
  ) => {
    invokes.set(channel, listener)
    return originalHandle(channel, listener)
  }) as IpcHandleHost['handle']

  if (typeof ipcMain.on === 'function') {
    const originalOn = ipcMain.on.bind(ipcMain)
    ipcMain.on = ((
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown
    ) => {
      const list = sends.get(channel) ?? []
      list.push(listener)
      sends.set(channel, list)
      return originalOn(channel, listener)
    }) as IpcHandleHost['on']
  }

  return {
    async invoke(channel, args, event) {
      const listener = invokes.get(channel)
      if (!listener) throw new Error(`No IPC invoke handler for ${channel}`)
      return listener(event, ...args)
    },
    send(channel, args, event) {
      for (const listener of sends.get(channel) ?? []) listener(event, ...args)
    },
    channels: () => [...invokes.keys()]
  }
}
