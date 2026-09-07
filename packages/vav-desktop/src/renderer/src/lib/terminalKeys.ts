/**
 * Kitty CSI-u for Shift+Enter. xterm.js sends the same `\r` for Enter and
 * Shift+Enter, so CLI agents (Claude Code, Codex, Grok, …) treat both as
 * submit. This is the sequence VS Code / Claude `/terminal-setup` emit.
 */
export const KITTY_SHIFT_ENTER = '\x1b[13;2u'

/** ⌘V on Mac, Ctrl+V (or Ctrl+Shift+V) elsewhere — never send Super+v to a TUI. */
export function isTerminalPasteChord(
  ev: {
    type?: string
    key: string
    code?: string
    shiftKey: boolean
    altKey: boolean
    metaKey: boolean
    ctrlKey: boolean
  },
  mac = typeof process !== 'undefined' && process.platform === 'darwin'
): boolean {
  if (ev.type && ev.type !== 'keydown') return false
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
  if (key !== 'v' && ev.code !== 'KeyV') return false
  if (ev.altKey) return false
  if (mac) return ev.metaKey && !ev.ctrlKey
  return ev.ctrlKey && !ev.metaKey
}

export function isBareShiftEnter(ev: {
  type?: string
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): boolean {
  if (ev.type && ev.type !== 'keydown') return false
  if (ev.key !== 'Enter') return false
  return ev.shiftKey && !ev.altKey && !ev.metaKey && !ev.ctrlKey
}
