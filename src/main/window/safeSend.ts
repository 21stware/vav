import { isIgnorableStreamError } from '../process/stdioGuard.ts'

export type SendableContents = {
  isDestroyed: () => boolean
  send: (channel: string, payload?: unknown) => void
}

type ObserveSendHook = (channel: string, payload: unknown) => void

let observeSendHook: ObserveSendHook | null = null
let lastObserveChannel = ''
let lastObservePayload: unknown = undefined

/** Fan-out renderer IPC to the localhost observe proxy. Dedupes same-tick multi-window sends. */
export function setObserveSendHook(hook: ObserveSendHook | null): void {
  observeSendHook = hook
  lastObserveChannel = ''
  lastObservePayload = undefined
}

function fanoutObserve(channel: string, payload: unknown): void {
  if (!observeSendHook) return
  if (channel === lastObserveChannel && payload === lastObservePayload) return
  lastObserveChannel = channel
  lastObservePayload = payload
  observeSendHook(channel, payload)
}

/** IPC to a renderer that may already be tearing down (close / HMR / pkill). */
export function safeSend(
  contents: SendableContents | null | undefined,
  channel: string,
  payload?: unknown
): void {
  fanoutObserve(channel, payload)
  if (!contents || contents.isDestroyed()) return
  try {
    if (payload === undefined) contents.send(channel)
    else contents.send(channel, payload)
  } catch (err) {
    if (isIgnorableStreamError(err)) return
    // Frame can vanish between isDestroyed check and send under load.
  }
}
