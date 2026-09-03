/**
 * Gate privileged IPC to the app's own renderer main frames.
 * Guest frames (srcdoc clips, webviews) must not invoke files / secrets.
 */

export type IpcSenderLike = {
  sender: {
    isDestroyed: () => boolean
    mainFrame?: unknown
    getURL: () => string
  }
  senderFrame?: { url?: string } | null
}

export function isTrustedIpcSender(
  event: IpcSenderLike,
  isAppRendererUrl: (url: string) => boolean
): boolean {
  const wc = event.sender
  if (!wc || wc.isDestroyed()) return false
  try {
    const frame = event.senderFrame
    if (frame) {
      if (wc.mainFrame && frame !== wc.mainFrame) return false
      const url = frame.url
      if (url && url !== 'about:blank' && !isAppRendererUrl(url)) return false
    } else {
      const url = wc.getURL()
      if (url && url !== 'about:blank' && !isAppRendererUrl(url)) return false
    }
  } catch {
    return false
  }
  return true
}

export type IpcHandleHost = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown
  ) => unknown
}

/** Wrap `ipcMain.handle` so guest frames cannot invoke privileged channels. */
export function installTrustedIpcGuard(
  ipcMain: IpcHandleHost,
  isAppRendererUrl: (url: string) => boolean
): void {
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown
  ) =>
    originalHandle(channel, async (event, ...args) => {
      if (!isTrustedIpcSender(event as IpcSenderLike, isAppRendererUrl)) {
        console.error(`[ipc] blocked untrusted sender for ${channel}`)
        throw new Error('Blocked IPC from untrusted frame')
      }
      try {
        return await listener(event, ...args)
      } catch (err) {
        console.error(`[ipc] ${channel}`, err)
        throw err
      }
    })) as IpcHandleHost['handle']
}
