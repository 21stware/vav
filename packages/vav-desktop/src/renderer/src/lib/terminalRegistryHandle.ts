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
  refreshAllTerminals?(): void
  disposeTerminal(conversationId: string, tabId: string): void
  parkTerminal?(conversationId: string, tabId: string): void
  pauseTerminalPaint?(conversationId: string, tabId: string): void
  resumeTerminalPaint?(conversationId: string, tabId: string): void
  markTerminalProcessExited?(tabId: string): void
  resetTerminalForNewProcess?(conversationId: string, tabId: string): void
  peekLiveTerminalGrid?(): { cols: number; rows: number } | null
}

/** Last font size applied to xterm (already `max(11, settings - 1)`). */
let lastFontSize = 12

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
  lastFontSize = fontSize
  if (!api) {
    pending = { fontFamily, fontSize, bashBackground }
    return
  }
  api.applyTerminalAppearance(fontFamily, fontSize, bashBackground)
}

export function lastTerminalFontSize(): number {
  return lastFontSize
}

/** Live agent xterm grid, if one is already fitted in this renderer. */
export function peekLiveTerminalGrid(): { cols: number; rows: number } | null {
  return api?.peekLiveTerminalGrid?.() ?? null
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

/** Re-blit live xterm canvases after a sibling window steals GPU textures. */
export function refreshAllTerminals(): void {
  api?.refreshAllTerminals?.()
}

/** A PTY died: its buffer is history, not the next process's scrollback. */
export function markTerminalProcessExited(tabId: string): void {
  api?.markTerminalProcessExited?.(tabId)
}

/** Blank a reused tab id (stable CLI agent pane) before a fresh PTY paints. */
export function resetTerminalForNewProcess(conversationId: string, tabId: string): void {
  api?.resetTerminalForNewProcess?.(conversationId, tabId)
}

/** Soft-park when available; falls back to hard dispose for older bundles. */
export function parkTerminal(conversationId: string, tabId: string): void {
  if (api?.parkTerminal) {
    api.parkTerminal(conversationId, tabId)
    return
  }
  api?.disposeTerminal(conversationId, tabId)
}
