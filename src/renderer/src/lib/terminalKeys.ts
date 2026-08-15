/**
 * Kitty CSI-u for Shift+Enter. xterm.js sends the same `\r` for Enter and
 * Shift+Enter, so CLI agents (Claude Code, Codex, Grok, …) treat both as
 * submit. This is the sequence VS Code / Claude `/terminal-setup` emit.
 */
export const KITTY_SHIFT_ENTER = '\x1b[13;2u'

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
