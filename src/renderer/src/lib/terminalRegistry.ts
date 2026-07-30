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
 * box. ANSI / 256 / truecolor from CLI agents (Claude Code, etc.) paint on top
 * of this base — keep the 16-color palette saturated enough for TUI apps.
 *
 * Background must stay in sync with `--bg-terminal`.
 */
const THEME_DARK = {
  background: '#101012',
  foreground: '#e6e6e7',
  cursor: '#e6e6e7',
  cursorAccent: '#101012',
  selectionBackground: 'rgba(141, 124, 230, 0.35)',
  selectionForeground: undefined,
  // Standard-ish ANSI so agent TUIs don't look washed out.
  black: '#1c1c1f',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#fcc419',
  blue: '#4dabf7',
  magenta: '#da77f2',
  cyan: '#22b8cf',
  white: '#e6e6e7',
  brightBlack: '#868e96',
  brightRed: '#ff8787',
  brightGreen: '#69db7c',
  brightYellow: '#ffe066',
  brightBlue: '#74c0fc',
  brightMagenta: '#e599f7',
  brightCyan: '#66d9e8',
  brightWhite: '#f8f9fa'
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
  container.className = 'xterm-host'
  container.style.width = '100%'
  container.style.height = '100%'

  const term = new Terminal({
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    fontWeight: '400',
    fontWeightBold: '700',
    cursorBlink: true,
    cursorStyle: 'block',
    disableStdin: false,
    scrollback: 10_000,
    convertEol: false,
    // Full color for modern CLI agent TUIs (Claude Code, etc.).
    allowProposedApi: true,
    drawBoldTextInBrightColors: true,
    // Don't dim / recolor agent truecolor output.
    minimumContrastRatio: 1,
    theme: THEME_DARK,
    // Mac: option as meta for readline-style shortcuts in agents.
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true
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
