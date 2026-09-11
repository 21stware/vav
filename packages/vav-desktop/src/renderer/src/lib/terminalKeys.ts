/**
 * Kitty CSI-u for Shift+Enter. xterm.js sends the same `\r` for Enter and
 * Shift+Enter, so CLI agents (Claude Code, Codex, Grok, …) treat both as
 * submit. This is the sequence VS Code / Claude `/terminal-setup` emit.
 */
export const KITTY_SHIFT_ENTER = '\x1b[13;2u'

/** Classic C0 bytes the kernel / most TUIs treat as interrupt, EOF, stop, quit. */
export const TERMINAL_C0 = {
  etx: '\x03',
  eot: '\x04',
  sub: '\x1a',
  fs: '\x1c'
} as const

type TerminalKeyEvent = {
  type?: string
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

/**
 * Product chords use the platform primary modifier (⌘ on Mac, Ctrl elsewhere).
 * Treating Ctrl as ⌘ on Mac stole readline (Ctrl+K / Ctrl+D / Ctrl+W) from
 * the PTY, so a running session could not be driven from the keyboard.
 */
export function isTerminalProductModifier(ev: TerminalKeyEvent, mac: boolean): boolean {
  if (ev.altKey) return false
  if (mac) return ev.metaKey && !ev.ctrlKey
  return ev.ctrlKey && !ev.metaKey
}

/**
 * Force legacy C0 for job-control chords.
 *
 * With Kitty keyboard enabled, xterm encodes Ctrl+C as CSI-u (`\x1b[99;5u`).
 * Claude / Grok / Codex listen for `\x03` to abort a running turn — CSI-u is
 * ignored, the spinner never dies, and the same session cannot be reused.
 */
export function terminalC0ForChord(ev: TerminalKeyEvent, mac: boolean): string | null {
  if (ev.type && ev.type !== 'keydown') return null
  if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return null
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
  if (key === 'c' || ev.code === 'KeyC') return TERMINAL_C0.etx
  if (key === 'z' || ev.code === 'KeyZ') return TERMINAL_C0.sub
  if (key === '\\' || ev.code === 'Backslash') return TERMINAL_C0.fs
  // Ctrl+D is EOF on Mac (⌘D splits). Elsewhere Ctrl+D is the split chord.
  if (mac && (key === 'd' || ev.code === 'KeyD')) return TERMINAL_C0.eot
  return null
}

/** Win/Linux: Ctrl+C copies a terminal selection instead of interrupting. */
export function shouldCopyInsteadOfInterrupt(
  ev: TerminalKeyEvent,
  hasSelection: boolean,
  mac: boolean
): boolean {
  return !mac && hasSelection && terminalC0ForChord(ev, mac) === TERMINAL_C0.etx
}

/** ⌘V on Mac, Ctrl+V (or Ctrl+Shift+V) elsewhere — never send Super+v to a TUI. */
export function isTerminalPasteChord(
  ev: TerminalKeyEvent,
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
