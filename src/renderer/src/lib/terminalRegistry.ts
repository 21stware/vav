import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { registerTerminalSink } from '../state/workspaceStore'

export interface TerminalEntry {
  term: Terminal
  fit: FitAddon
  /** Detached host element; views adopt it on mount and release it on unmount. */
  container: HTMLDivElement
  dispose: () => void
}

const entries = new Map<string, TerminalEntry>()

function key(conversationId: string, tabId: string): string {
  return `${conversationId}::${tabId}`
}

/**
 * Neutral-grey shell so the terminal reads as part of the app, not a pasted-in
 * box: the surface carries no hue and the ANSI colours do all the work.
 *
 * The background is opaque and must stay in sync with `--bg-terminal`: xterm
 * paints its viewport with this colour, so any mismatch shows up as a seam
 * around the padding of the host element.
 */
const THEME_DARK = {
  background: '#101012',
  foreground: '#dededf',
  cursor: '#b7aaf3',
  cursorAccent: '#101012',
  selectionBackground: 'rgba(141, 124, 230, 0.32)',
  black: '#2c2c30',
  red: '#e8817c',
  green: '#8fcaa8',
  yellow: '#d8ac62',
  blue: '#93b4ea',
  magenta: '#b0a2ec',
  cyan: '#6fc3ce',
  white: '#dededf',
  brightBlack: '#73737b',
  brightRed: '#f0a09b',
  brightGreen: '#aadcc0',
  brightYellow: '#e8cb96',
  brightBlue: '#b3caf2',
  brightMagenta: '#c8bdf4',
  brightCyan: '#96d6df',
  brightWhite: '#f4f4f5'
}

/**
 * Creates (or returns) the live terminal for a tab.
 *
 * Instances live outside the React tree so switching tabs, collapsing the tools
 * panel, or moving to another conversation never destroys scrollback or the
 * underlying PTY (README §2.6, terminal-panel.rpml annotation 2).
 */
export function acquireTerminal(options: {
  conversationId: string
  tabId: string
  fontFamily: string
  fontSize: number
}): TerminalEntry {
  const id = key(options.conversationId, options.tabId)
  const existing = entries.get(id)
  if (existing) {
    existing.term.options.fontFamily = options.fontFamily
    existing.term.options.fontSize = options.fontSize
    return existing
  }

  const container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'

  const term = new Terminal({
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    cursorBlink: true,
    cursorStyle: 'block',
    disableStdin: false,
    scrollback: 10_000,
    theme: THEME_DARK
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(container)

  term.onData((data) => void window.vav.pty.write(options.tabId, data))
  term.onResize(({ cols, rows }) => void window.vav.pty.resize(options.tabId, cols, rows))

  const unregister = registerTerminalSink(options.conversationId, options.tabId, (data) =>
    term.write(data)
  )

  const entry: TerminalEntry = {
    term,
    fit,
    container,
    dispose: () => {
      unregister()
      term.dispose()
      entries.delete(id)
    }
  }
  entries.set(id, entry)
  return entry
}

export function disposeTerminal(conversationId: string, tabId: string): void {
  entries.get(key(conversationId, tabId))?.dispose()
}

export function applyTerminalAppearance(fontFamily: string, fontSize: number): void {
  for (const entry of entries.values()) {
    entry.term.options.fontFamily = fontFamily
    entry.term.options.fontSize = fontSize
    try {
      entry.fit.fit()
    } catch {
      // Not attached to the DOM yet; the next mount fits it.
    }
  }
}
