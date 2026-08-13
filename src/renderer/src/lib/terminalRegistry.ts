import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { registerTerminalSink } from '../state/workspaceStore'
import { IS_MAC } from './platform'
import { publishTerminalRegistry } from './terminalRegistryHandle'
import type { BashBackgroundMode } from '@shared/types'

export type TerminalSurface = 'bash' | 'agent'

export interface TerminalEntry {
  term: Terminal
  fit: FitAddon
  /** Detached host element; views adopt it on mount and release it on unmount. */
  container: HTMLDivElement
  dispose: () => void
  /**
   * Soft-park: sink still receives bytes (buffer stays live) but the host is
   * not driving PTY geometry. Used when a companion window owns the viewer.
   */
  parked: boolean
  /** Tools-tray bash vs CLI agent / install PTY. Drives bash-only dark bg. */
  surface: TerminalSurface
}

const entries = new Map<string, TerminalEntry>()

/** Last Appearance setting; bash terminals may ignore app theme. */
let bashBackgroundMode: BashBackgroundMode = 'theme'

function key(conversationId: string, tabId: string): string {
  return `${conversationId}::${tabId}`
}

/**
 * Neutral-grey shell so the terminal reads as part of the app, not a pasted-in
 * box. ANSI / 256 / truecolor from CLI agents (Claude Code, etc.) paint on top
 * of this base — keep the 16-color palette saturated enough for TUI apps.
 *
 * Background tracks `--bg-content` so swarm / CLI agents match Thread.
 * Tools-tray bash can stay on the dark palette when Appearance asks for it.
 * Light palette is ink-heavy: the dark-surface pastels wash out on paper.
 */
const ANSI_DARK = {
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
} as const

const ANSI_LIGHT = {
  black: '#141416',
  red: '#c92a2a',
  green: '#2b8a3e',
  yellow: '#d9480f',
  blue: '#1864ab',
  magenta: '#9c36b5',
  cyan: '#0b7285',
  white: '#34343a',
  brightBlack: '#6b6b74',
  brightRed: '#e03131',
  brightGreen: '#2f9e44',
  brightYellow: '#e67700',
  brightBlue: '#1c7ed6',
  brightMagenta: '#ae3ec9',
  brightCyan: '#0c8599',
  brightWhite: '#141416'
} as const

const DARK_PLATE = '#1b1b1d'
const DARK_INK = '#e6e6e7'
const LIGHT_INK = '#141416'

function isDarkAppearance(): boolean {
  const theme = document.documentElement.dataset.theme
  if (theme === 'light' || theme === 'dark') return theme === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function contentBackground(dark: boolean): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--bg-content').trim()
  if (value) return value
  return dark ? DARK_PLATE : '#fcfcfc'
}

function resolvedTerminalTheme(forceDark = false) {
  const dark = forceDark || isDarkAppearance()
  const background = forceDark ? DARK_PLATE : contentBackground(dark)
  const ink = dark ? DARK_INK : LIGHT_INK
  return {
    background,
    foreground: ink,
    cursor: ink,
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(141, 124, 230, 0.35)' : 'rgba(24, 100, 171, 0.22)',
    ...(dark ? ANSI_DARK : ANSI_LIGHT)
  }
}

function forceDarkBash(entry: Pick<TerminalEntry, 'surface'>): boolean {
  return entry.surface === 'bash' && bashBackgroundMode === 'dark'
}

function paintTerminalTheme(entry: TerminalEntry): void {
  // New object every time — xterm compares theme by reference.
  entry.term.options.theme = { ...resolvedTerminalTheme(forceDarkBash(entry)) }
  try {
    if (entry.term.rows > 0) entry.term.refresh(0, entry.term.rows - 1)
  } catch {
    // Detached / zero-size host; next fit paints it.
  }
}

/**
 * Both xterm's OSC 8 handler and the web-links addon open a blank window and
 * then assign `location` — Electron denies a `window.open()` that carries no
 * URL, so those clicks did nothing. Send the URL with the call instead; main's
 * window-open handler is what passes it to the browser.
 *
 * Terminal convention: only the modifier-held click leaves the app, so a click
 * that was aimed at the shell cannot fling the user into a browser.
 */
function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!(IS_MAC ? event.metaKey : event.ctrlKey)) return
  window.open(uri, '_blank', 'noopener,noreferrer')
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
  surface?: TerminalSurface
}): TerminalEntry {
  const id = key(options.conversationId, options.tabId)
  const surface = options.surface ?? 'bash'
  const existing = entries.get(id)
  if (existing) {
    existing.surface = surface
    existing.term.options.fontFamily = options.fontFamily
    existing.term.options.fontSize = options.fontSize
    paintTerminalTheme(existing)
    // Reclaim after soft-park or React remount/reparent — keep the painted
    // buffer, then force fit/SIGWINCH so TUIs match this host's real box
    // (avoids the 1-row “narrow strip” from a prior zero-size fit).
    const wasParked = existing.parked
    existing.parked = false
    if (wasParked || !existing.container.isConnected) {
      queueMicrotask(() => {
        if (entries.get(id) !== existing) return
        try {
          if (
            existing.container.clientWidth > 0 &&
            existing.container.clientHeight > 0
          ) {
            existing.fit.fit()
            window.vav.pty.resize(
              options.tabId,
              existing.term.cols,
              existing.term.rows,
              true
            )
          }
        } catch {
          // host may not be in the DOM yet; TerminalHost fit handles that
        }
      })
    }
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
    theme: resolvedTerminalTheme(surface === 'bash' && bashBackgroundMode === 'dark'),
    // Mac: option as meta for readline-style shortcuts in agents.
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    // OSC 8 hyperlinks (gh, eza, agent CLIs) — same route as plain URLs, and
    // without xterm's stock "Do you want to navigate to…" confirm.
    linkHandler: {
      activate: (event, text) => openTerminalLink(event, text)
    }
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon(openTerminalLink))
  term.open(container)

  term.onData((data) => {
    window.vav.pty.write(options.tabId, data)
  })
  // Only the focused window drives PTY geometry. Background windows still
  // receive the stream, but must not stomp cols/rows (causes TUI ghost frames).
  //
  // Alt-screen TUIs (Claude Code): xterm does not reflow the alt buffer, so a
  // sudden geometry jump (title-bar maximize/restore) leaves truncated cells.
  // Async CSI clears race the write queue and look like "content scrolled up".
  // Fix: discard the pending write queue, synchronously clear the active buffer
  // cells (same clean slate as reset, without RIS / mode loss), hold paint two
  // frames, then force SIGWINCH. Normal-buffer bash keeps scrollback untouched.
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSize: { cols: number; rows: number } | null = null
  let lastApplied = { cols: 0, rows: 0 }
  /** Drop PTY→xterm bytes while the alt buffer is rebuilt (sync, short). */
  let suppressPtyPaint = false

  /**
   * xterm internals used for a true alt-buffer rebuild. Public `write` is async
   * and shares a queue with PTY output — ED2 alone cannot outrun half-frames.
   */
  type XtermCore = {
    writeSync?: (data: string) => void
    _writeBuffer?: {
      _writeBuffer: unknown[]
      _callbacks: unknown[]
      _pendingData: number
      _bufferOffset: number
    }
    _bufferService?: {
      buffer: {
        clear: () => void
        fillViewportRows: () => void
        scrollTop: number
        scrollBottom: number
        ybase: number
        ydisp: number
        x: number
        y: number
      }
      rows: number
    }
  }

  const discardWriteQueue = (core: XtermCore): void => {
    const wb = core._writeBuffer
    if (!wb) return
    // Drop every chunk already queued (old-geometry redraw) and cancel a
    // scheduled _innerWrite by matching writeSync's post-drain markers.
    wb._writeBuffer.length = 0
    wb._callbacks.length = 0
    wb._pendingData = 0
    wb._bufferOffset = 0x7fffffff
  }

  /**
   * Synchronously blank the active (alt) buffer without RIS / leave-alt.
   * Keeps DEC modes the TUI already negotiated; only cells + cursor + scroll
   * region are reset. Dropping the write queue first is essential — otherwise
   * pending half-frames repaint after this clear.
   */
  const hardRebuildAlt = (): void => {
    const core = (term as unknown as { _core?: XtermCore })._core
    if (core) {
      discardWriteQueue(core)
      const buf = core._bufferService?.buffer
      if (buf && typeof buf.clear === 'function') {
        buf.clear()
        buf.fillViewportRows()
        buf.scrollTop = 0
        buf.scrollBottom = Math.max(0, (core._bufferService?.rows ?? term.rows) - 1)
        buf.x = 0
        buf.y = 0
        buf.ybase = 0
        buf.ydisp = 0
        try {
          term.refresh(0, Math.max(0, term.rows - 1))
          term.clearTextureAtlas?.()
        } catch {
          // ignore
        }
        return
      }
      // Fallback: leave+re-enter alt in one sync turn (blank alt, no flash).
      if (typeof core.writeSync === 'function') {
        core.writeSync('\x1b[?1049l\x1b[?1049h\x1b[r\x1b[0m\x1b[H\x1b[2J\x1b[3J')
        try {
          term.refresh(0, Math.max(0, term.rows - 1))
        } catch {
          // ignore
        }
        return
      }
    }
    term.write('\x1b[H\x1b[2J\x1b[3J')
    try {
      term.refresh(0, Math.max(0, term.rows - 1))
    } catch {
      // ignore
    }
  }

  const applyResize = (): void => {
    resizeTimer = null
    if (!pendingSize) return
    // Keep pending if unfocused — focus handler will flush. Do not drop size.
    if (!document.hasFocus()) return
    const { cols, rows } = pendingSize
    pendingSize = null
    if (cols === lastApplied.cols && rows === lastApplied.rows) return
    lastApplied = { cols, rows }

    try {
      if (term.buffer.active.type === 'alternate') {
        // 1) Sync blank the alt buffer + drop queued half-frames.
        // 2) Hold the paint gate two frames so in-flight IPC from the old
        //    geometry cannot land on the fresh cells (title-bar maximize
        //    especially races main→renderer with the winsize change).
        // 3) SIGWINCH, then open the gate for the app's full redraw.
        suppressPtyPaint = true
        hardRebuildAlt()
        const signalCols = cols
        const signalRows = rows
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (lastApplied.cols !== signalCols || lastApplied.rows !== signalRows) {
              // Superseded by a newer settle.
              suppressPtyPaint = false
              return
            }
            try {
              window.vav.pty.resize(options.tabId, signalCols, signalRows, true)
            } finally {
              suppressPtyPaint = false
            }
          })
        })
        return
      }
    } catch {
      suppressPtyPaint = false
    }
    window.vav.pty.resize(options.tabId, cols, rows)
  }

  term.onResize(({ cols, rows }) => {
    pendingSize = { cols, rows }
    if (!document.hasFocus()) return
    if (resizeTimer) clearTimeout(resizeTimer)
    // Live panel/window drag fits xterm for a tracking canvas, but must not
    // SIGWINCH the agent every frame (Claude half-draws / stacked borders).
    // Stash until settle — vav:resize-end / focus flush applyResize.
    if (document.documentElement.dataset.resizing === 'true') return
    // Title-bar maximize/restore settles over multiple layout passes; short
    // debounces SIGWINCH'd intermediate sizes that Claude half-drew.
    resizeTimer = setTimeout(applyResize, 150)
  })

  // Unfocused windows can fit (and stash pendingSize) without applying; flush
  // when this window becomes frontmost so PTY geometry matches xterm.
  const onWindowFocus = (): void => {
    if (!pendingSize) return
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(applyResize, 0)
  }
  const onResizeEnd = (): void => {
    if (!pendingSize || !document.hasFocus()) return
    if (resizeTimer) clearTimeout(resizeTimer)
    // Drag already fitted to the final box — onResize may not fire again.
    resizeTimer = setTimeout(applyResize, 0)
  }
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('vav:resize-end', onResizeEnd)

  // Let product accelerators leave the terminal (⌘⇧E, Ctrl+`, …). Main also
  // re-dispatches via before-input-event; this stops xterm from consuming them
  // as shell input when the native path still delivers the key to the page.
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const meta = ev.metaKey || ev.ctrlKey
    if (!meta && !(ev.ctrlKey && !ev.metaKey)) return true
    // Control+` (tools bash) — never send backtick to the shell with Ctrl held.
    if (ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && (ev.key === '`' || ev.code === 'Backquote')) {
      return false
    }
    if (!meta || ev.altKey) return true
    const key = ev.key.toLowerCase()
    // Cmd/Ctrl + Shift + letter product shortcuts
    if (ev.shiftKey && (key === 'e' || key === 'h' || key === 't' || key === 'o' || key === 'g')) {
      return false
    }
    // Cmd/Ctrl + letter / digit product shortcuts (incl. ⌘W context-close)
    if (
      !ev.shiftKey &&
      (key === 'n' ||
        key === 'k' ||
        key === 'i' ||
        key === 'f' ||
        key === 'g' ||
        key === 't' ||
        key === 'w' ||
        key === ',' ||
        /^[1-9]$/.test(key) ||
        key === 'enter')
    ) {
      return false
    }
    return true
  })

  // Gate live writes until scrollback replay finishes so a second window does not
  // paint "new chunks first, then full history" (which looks like a corrupt TUI).
  let replaying = typeof window.vav.pty.replay === 'function'
  const liveQueue: string[] = []
  const unregister = registerTerminalSink(options.conversationId, options.tabId, (data) => {
    // Stale bytes from the previous geometry while we wipe + SIGWINCH — drop.
    // Replaying them after the wipe reintroduces the "scrolled-up" ghosts.
    if (suppressPtyPaint) return
    if (replaying) {
      liveQueue.push(data)
      return
    }
    term.write(data)
  })

  const entry: TerminalEntry = {
    term,
    fit,
    container,
    parked: false,
    surface,
    dispose: () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
        resizeTimer = null
      }
      suppressPtyPaint = false
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('vav:resize-end', onResizeEnd)
      // Flush last size if we dispose mid-debounce (window close / tab kill).
      if (pendingSize && document.hasFocus()) {
        const { cols, rows } = pendingSize
        pendingSize = null
        try {
          window.vav.pty.resize(options.tabId, cols, rows)
        } catch {
          // ignore
        }
      }
      unregister()
      term.dispose()
      entries.delete(id)
    }
  }
  entries.set(id, entry)

  // Multi-window attach: main keeps a ring buffer so a detached window is not blank.
  // After paint, force SIGWINCH so alt-screen TUIs redraw for this viewer's size
  // (Herdr attaches with a fresh screen frame from the host).
  if (replaying) {
    void window.vav.pty
      .replay(options.tabId)
      .then((buf) => {
        if (entries.get(id)?.term !== term) return
        if (buf) term.write(buf)
        replaying = false
        for (const chunk of liveQueue) term.write(chunk)
        liveQueue.length = 0
        requestAnimationFrame(() => {
          if (entries.get(id)?.term !== term) return
          if (!document.hasFocus()) return
          try {
            fit.fit()
            window.vav.pty.resize(options.tabId, term.cols, term.rows, true)
          } catch {
            // ignore
          }
        })
      })
      .catch(() => {
        replaying = false
        for (const chunk of liveQueue) term.write(chunk)
        liveQueue.length = 0
      })
  }

  return entry
}

/**
 * Soft-park: detach from the DOM but keep the xterm + live sink so reclaim is
 * instant when the companion window closes. Does **not** kill the PTY.
 *
 * Hard dispose is reserved for user-closed tabs.
 */
export function parkTerminal(conversationId: string, tabId: string): void {
  const entry = entries.get(key(conversationId, tabId))
  if (!entry) return
  entry.parked = true
  entry.container.remove()
}

export function disposeTerminal(conversationId: string, tabId: string): void {
  entries.get(key(conversationId, tabId))?.dispose()
}

/** Re-fit every live xterm in this renderer (call on window focus). */
export function fitAllTerminals(): void {
  if (!document.hasFocus()) return
  for (const entry of entries.values()) {
    try {
      entry.fit.fit()
    } catch {
      // host may be detached
    }
  }
}

export function applyTerminalAppearance(
  fontFamily: string,
  fontSize: number,
  bashBackground?: BashBackgroundMode
): void {
  if (bashBackground === 'dark' || bashBackground === 'theme') {
    bashBackgroundMode = bashBackground
  }
  for (const entry of entries.values()) {
    entry.term.options.fontFamily = fontFamily
    entry.term.options.fontSize = fontSize
    paintTerminalTheme(entry)
    try {
      entry.fit.fit()
    } catch {
      // Not attached to the DOM yet; the next mount fits it.
    }
  }
}

/** Re-mint xterm ink after `data-theme` flips (fonts unchanged). */
export function paintTerminalThemes(): void {
  for (const entry of entries.values()) {
    paintTerminalTheme(entry)
  }
}

publishTerminalRegistry({
  applyTerminalAppearance,
  paintTerminalThemes,
  disposeTerminal,
  parkTerminal
})
