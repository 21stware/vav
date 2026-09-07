/**
 * Shared send-key policy for every vav composer surface
 * (main session, workspace agent column, file-preview drawer).
 *
 * Settings → Appearance → sendKey:
 * - `enter` (default): Enter sends; Shift/Alt+Enter insert a newline.
 * - `mod-enter`: ⌘/Ctrl+Enter sends; plain Enter inserts a newline.
 */

export type SendKeyMode = 'enter' | 'mod-enter'

export function resolveSendKeyMode(raw: string | undefined | null): SendKeyMode {
  return raw === 'mod-enter' ? 'mod-enter' : 'enter'
}

export function shouldSendOnKeyDown(
  event: {
    key: string
    shiftKey: boolean
    altKey: boolean
    metaKey: boolean
    ctrlKey: boolean
  },
  mode: SendKeyMode
): boolean {
  if (event.key !== 'Enter') return false
  const mod = event.metaKey || event.ctrlKey
  if (mode === 'enter') {
    // Enter (and bare Cmd/Ctrl+Enter) send; Shift/Alt+Enter keep a newline.
    if (event.shiftKey || event.altKey) return false
    return true
  }
  return mod
}
