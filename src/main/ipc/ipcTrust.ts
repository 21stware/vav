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
