/**
 * Late-bound view of the xterm registry.
 *
 * Windows that may never host a terminal (file preview) still forward font
 * changes and tab disposals. Importing `terminalRegistry` for that alone pulls
 * @xterm/xterm into their first-paint chunk. `terminalRegistry` publishes
 * itself here the moment a real terminal host loads it; until then every call
 * targets an empty registry and is a no-op.
 */

import type { BashBackgroundMode } from '@shared/types'

export type TerminalRegistryApi = {
  applyTerminalAppearance(
    fontFamily: string,
    fontSize: number,
    bashBackground?: BashBackgroundMode
  ): void
  paintTerminalThemes?(): void
  disposeTerminal(conversationId: string, tabId: string): void
  parkTerminal?(conversationId: string, tabId: string): void
}

let api: TerminalRegistryApi | null = null
let pending: {
  fontFamily: string
  fontSize: number
  bashBackground?: BashBackgroundMode
} | null = null
let pendingPaint = false

export function publishTerminalRegistry(next: TerminalRegistryApi): void {
  api = next
  if (pending) {
    next.applyTerminalAppearance(pending.fontFamily, pending.fontSize, pending.bashBackground)
    pending = null
    pendingPaint = false
  } else if (pendingPaint) {
    next.paintTerminalThemes?.()
    pendingPaint = false
  }
}

export function applyTerminalAppearance(
  fontFamily: string,
  fontSize: number,
  bashBackground?: BashBackgroundMode
): void {
  if (!api) {
    pending = { fontFamily, fontSize, bashBackground }
    return
  }
  api.applyTerminalAppearance(fontFamily, fontSize, bashBackground)
}

/** Re-mint xterm ink after Appearance light/dark. No-op until a host loads. */
export function paintTerminalThemes(): void {
  if (!api) {
    pendingPaint = true
    return
  }
  api.paintTerminalThemes?.()
}

export function disposeTerminal(conversationId: string, tabId: string): void {
  api?.disposeTerminal(conversationId, tabId)
}

/** Soft-park when available; falls back to hard dispose for older bundles. */
export function parkTerminal(conversationId: string, tabId: string): void {
  if (api?.parkTerminal) {
    api.parkTerminal(conversationId, tabId)
    return
  }
  api?.disposeTerminal(conversationId, tabId)
}
