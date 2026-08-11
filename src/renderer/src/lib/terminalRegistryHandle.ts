/**
 * Late-bound view of the xterm registry.
 *
 * Windows that may never host a terminal (file preview) still forward font
 * changes and tab disposals. Importing `terminalRegistry` for that alone pulls
 * @xterm/xterm into their first-paint chunk. `terminalRegistry` publishes
 * itself here the moment a real terminal host loads it; until then every call
 * targets an empty registry and is a no-op.
 */

export type TerminalRegistryApi = {
  applyTerminalAppearance(fontFamily: string, fontSize: number): void
  disposeTerminal(conversationId: string, tabId: string): void
  parkTerminal?(conversationId: string, tabId: string): void
}

let api: TerminalRegistryApi | null = null

export function publishTerminalRegistry(next: TerminalRegistryApi): void {
  api = next
}

export function applyTerminalAppearance(fontFamily: string, fontSize: number): void {
  api?.applyTerminalAppearance(fontFamily, fontSize)
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
