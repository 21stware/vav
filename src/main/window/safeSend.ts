import { isIgnorableStreamError } from '../process/stdioGuard.ts'

export type SendableContents = {
  isDestroyed: () => boolean
  send: (channel: string, payload?: unknown) => void
}

/** IPC to a renderer that may already be tearing down (close / HMR / pkill). */
export function safeSend(
  contents: SendableContents | null | undefined,
  channel: string,
  payload?: unknown
): void {
  if (!contents || contents.isDestroyed()) return
  try {
    if (payload === undefined) contents.send(channel)
    else contents.send(channel, payload)
  } catch (err) {
    if (isIgnorableStreamError(err)) return
    // Frame can vanish between isDestroyed check and send under load.
  }
}
