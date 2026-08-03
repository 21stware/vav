import * as pty from 'node-pty'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ShellKind } from '@shared/types'
import type { AgentContextLaunchStrategy } from '@shared/agentContextInject'
import { shellPath } from './StickyShell'
import { loginPath, resolveAgentExecutable } from './loginPath'
import { ensureClaudeWorkspaceTrusted, isClaudeCodeBinary } from './claudeTrust'

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const IS_WINDOWS = process.platform === 'win32'

/** Raw ring — used to reconstruct a single attach snapshot, not full history. */
const OUTPUT_BUFFER_CAP = 256 * 1024
/** Plain-shell attach: keep a short tail of line scrollback. */
const BASH_REPLAY_TAIL = 24 * 1024

/**
 * Public snapshot of a live PTY — main is the source of truth for multi-window
 * hydration (detached session + main sidebar must see the same tab ids).
 */
export interface PtySessionMeta {
  id: string
  conversationId: string
  /**
   * `null` = tools-tray plain bash.
   * `vav` = built-in agent mirror tab.
   * other = CLI agent host id (grok, claude-code, …).
   */
  agentId: string | null
  title: string
  createdAt: number
}

interface PtySession {
  id: string
  conversationId: string
  proc: pty.IPty
  /** Temp context file for --append-system-prompt-file; deleted on exit. */
  contextFile?: string | null
  agentId: string | null
  title: string
  createdAt: number
  /** Ring buffer of recent stdout for attach/replay. */
  outputBuffer: string
  appliedCols: number
  appliedRows: number
}


/** Optional agent launch — spawn the CLI directly (not "type into a shell"). */
export interface PtyLaunchOptions {
  preferredId?: string
  /**
   * Executable name or absolute path. When set, vav spawns this as the PTY
   * process so Claude Code / Codex / Grok open immediately.
   */
  command?: string
  /** Extra argv for `command`. */
  args?: string[]
  /** Alternate names to try if `command` is not on PATH. */
  commandCandidates?: string[]
  /** Merged into the PTY environment. */
  env?: Record<string, string>
  /**
   * Ambient context injected at process start (focused file, etc.).
   * Never written into the TTY as paste — only via argv / file when supported.
   */
  launchContext?: string | null
  contextLaunchStrategy?: AgentContextLaunchStrategy
  /**
   * Logical owner for multi-window restore.
   * `null`/omit = plain bash; CLI agent id for agent hosts; `vav` for mirror.
   */
  agentId?: string | null
  title?: string
}

function appendOutputBuffer(session: PtySession, data: string): void {
  session.outputBuffer += data
  if (session.outputBuffer.length > OUTPUT_BUFFER_CAP) {
    session.outputBuffer = session.outputBuffer.slice(
      session.outputBuffer.length - OUTPUT_BUFFER_CAP
    )
  }
}

/**
 * Build an attach snapshot that is safe to paint into a fresh xterm.
 *
 * Dumping the full ring buffer replays every TUI full-screen redraw as
 * scrollback ("legacy" junk above the live UI). Prefer content after the last
 * clear / alternate-screen enter; otherwise a short tail for bash only.
 */
export function snapshotForReplay(buffer: string, agentId: string | null): string {
  if (!buffer) return ''
  // Markers that start a "fresh screen" for modern TUIs (Claude Code, etc.).
  const markers = [
    '\x1b[?1049h', // alt screen enable
    '\x1b[?1047h',
    '\x1b[?47h',
    '\x1b[2J', // erase display
    '\x1b[3J', // erase scrollback
    '\x1bc' // RIS
  ]
  let cut = -1
  for (const m of markers) {
    const i = buffer.lastIndexOf(m)
    if (i > cut) cut = i
  }
  if (cut >= 0) return buffer.slice(cut)

  // CLI agent hosts without a clear marker: empty is better than 256KB of junk.
  // The next TUI paint (or resize) redraws the live UI.
  if (agentId && agentId !== 'vav') return ''

  if (buffer.length > BASH_REPLAY_TAIL) return buffer.slice(-BASH_REPLAY_TAIL)
  return buffer
}



/** True when the shell has a foreground child — a heuristic for "command running". */
function hasChildProcesses(pid: number): boolean {
  if (!pid || pid <= 0) return false
  if (IS_WINDOWS) {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`
        ],
        { encoding: 'utf8', windowsHide: true }
      )
      return out.trim().length > 0
    } catch {
      return false
    }
  }
  try {
    execFileSync('pgrep', ['-P', String(pid)], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Interactive PTYs for user shells and CLI agent hosts.
 *
 * Sessions outlive tab switches and panel collapse; only conversation deletion
 * and app quit tear them down (README §2.6).
 */
export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private onData: (tabId: string, data: string) => void,
    private onExit: (tabId: string) => void,
    /** Fired after create / kill so every renderer can re-hydrate tab maps. */
    private onChanged?: (conversationId: string) => void
  ) {}

  create(
    conversationId: string,
    shell: ShellKind,
    cwd: string,
    cols = 80,
    rows = 24,
    options?: PtyLaunchOptions | string
  ): string {
    // Back-compat: older callers passed preferredId as the last string arg.
    const opts: PtyLaunchOptions =
      typeof options === 'string' ? { preferredId: options } : (options ?? {})
    const preferredId = opts.preferredId
    if (preferredId && this.sessions.has(preferredId)) return preferredId
    const id = preferredId ?? randomUUID()
    // Prefer explicit agentId from the renderer; only special-case the legacy
    // vav mirror preferredId. Never infer from binary path (paths are not ids).
    const agentId =
      opts.agentId !== undefined ? opts.agentId : preferredId === 'agent' ? 'vav' : null
    const title =
      opts.title?.trim() ||
      (agentId && agentId !== 'vav' ? agentId : preferredId === 'agent' ? 'vav' : 'bash')
    // node-pty requires a real absolute directory — "~" or empty → process exits.
    let safeCwd = cwd && cwd !== '~' ? cwd : homedir()
    if (!safeCwd || !existsSync(safeCwd)) safeCwd = homedir()

    const pathEnv = loginPath()
    const baseEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: pathEnv,
      TERM: 'xterm-256color',
      // Claude Code / modern TUIs need truecolor hints.
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'vav',
      ...(opts.env ?? {})
    }
    // Node (and agents like Pi) warn when both are set; color is already
    // enabled via the real TTY + COLORTERM — don't force either flag.
    delete baseEnv.FORCE_COLOR
    delete baseEnv.NO_COLOR

    let file: string
    let args: string[]
    let contextFile: string | null = null

    if (opts.command?.trim()) {
      const candidates = [
        opts.command.trim(),
        ...(opts.commandCandidates ?? []).map((c) => c.trim()).filter(Boolean)
      ]
      const resolved = resolveAgentExecutable(candidates)
      if (resolved) {
        // Claude Code: skip "Yes, I trust this folder" for workspaces vav owns.
        // --dangerously-skip-permissions does not cover this dialog.
        if (isClaudeCodeBinary(resolved) || isClaudeCodeBinary(opts.command ?? '')) {
          ensureClaudeWorkspaceTrusted(safeCwd)
        }
        const agentArgs = [...(opts.args ?? [])]
        // Launch-time context via CLI flags (never PTY paste).
        const launch = applyLaunchContext(agentArgs, opts)
        contextFile = launch.contextFile
        if (IS_WINDOWS) {
          // Direct spawn on Windows.
          file = resolved
          args = agentArgs
        } else {
          // Login shell + exec: inherits user PATH/nvm/fnm, then replaces itself
          // with the agent so Claude Code / Codex own the TTY immediately.
          file = shellPath(shell)
          const cmdline = [shQuote(resolved), ...agentArgs.map(shQuote)].join(' ')
          args = ['-ilc', `exec ${cmdline}`]
        }
      } else {
        // Do not open a shell full of ANSI errors — renderer shows Install panel.
        const name = opts.command.trim()
        const err = new Error(`AGENT_NOT_FOUND:${name}`) as Error & { code: string }
        err.code = 'AGENT_NOT_FOUND'
        throw err
      }
    } else {
      file = shellPath(shell)
      // Login + interactive so user PATH matches Terminal.app when typing manually.
      args = IS_WINDOWS ? ['-NoLogo'] : ['-il']
    }

    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(1, rows),
      cwd: safeCwd,
      // ConPTY is what makes a Windows shell resizable and cursor-addressable
      // at all; without it node-pty falls back to winpty's line discipline.
      useConpty: IS_WINDOWS,
      env: baseEnv
    })
    const session: PtySession = {
      id,
      conversationId,
      proc,
      contextFile,
      agentId,
      title,
      createdAt: Date.now(),
      outputBuffer: '',
      appliedCols: Math.max(2, cols),
      appliedRows: Math.max(1, rows)
    }
    proc.onData((data) => {
      appendOutputBuffer(session, data)
      this.onData(id, data)
    })
    proc.onExit(() => {
      const current = this.sessions.get(id)
      if (current?.contextFile) {
        try {
          unlinkSync(current.contextFile)
        } catch {
          // temp cleanup is best-effort
        }
      }
      this.sessions.delete(id)
      this.onExit(id)
      this.onChanged?.(conversationId)
    })
    this.sessions.set(id, session)
    this.onChanged?.(conversationId)

    return id
  }

  /** Live PTY metadata for one conversation (stable tab ids across windows). */
  listForConversation(conversationId: string): PtySessionMeta[] {
    const out: PtySessionMeta[] = []
    for (const session of this.sessions.values()) {
      if (session.conversationId !== conversationId) continue
      out.push({
        id: session.id,
        conversationId: session.conversationId,
        agentId: session.agentId,
        title: session.title,
        createdAt: session.createdAt
      })
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return out
  }

  /**
   * Snapshot for a newly attached xterm — last screen only for agent TUIs,
   * short tail for plain bash. Never the full redraw history.
   */
  replay(tabId: string): string {
    const session = this.sessions.get(tabId)
    if (!session) return ''
    return snapshotForReplay(session.outputBuffer, session.agentId)
  }

  write(tabId: string, data: string): void {
    this.sessions.get(tabId)?.proc.write(data)
  }

  /**
   * Apply PTY size from the focused viewer (renderer gates unfocused windows).
   * Must match that window's xterm cols/rows exactly — max-across-viewers left
   * ghost TUI frames when a companion was smaller than the main window.
   *
   * @param force When true, always deliver a winsize change (nudge if already
   *   at this size) so TUIs get a fresh SIGWINCH after a local alt-buffer rebuild.
   */
  resize(tabId: string, cols: number, rows: number, _viewerId?: number, force = false): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    const c = Math.max(2, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    if (!force && c === session.appliedCols && r === session.appliedRows) return
    try {
      // Same size + force: kernel may skip SIGWINCH on a no-op TIOCSWINSZ.
      // Nudge one row then settle so the child always sees a real change.
      if (force && c === session.appliedCols && r === session.appliedRows) {
        const nudge = r > 1 ? r - 1 : r + 1
        try {
          session.proc.resize(c, nudge)
        } catch {
          // ignore nudge failure; final resize still attempted
        }
      }
      session.proc.resize(c, r)
      session.appliedCols = c
      session.appliedRows = r
    } catch {
      // Process may have exited between measure and apply.
    }
  }

  /** No-op kept for window-close callers; size is driven only by focused fit. */
  releaseViewer(_viewerId: number): void {
    // intentionally empty
  }

  kill(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    const conversationId = session.conversationId
    if (session.contextFile) {
      try {
        unlinkSync(session.contextFile)
      } catch {
        // ignore
      }
    }
    this.sessions.delete(tabId)
    try {
      // Windows has no signals; node-pty rejects the argument outright.
      if (IS_WINDOWS) session.proc.kill()
      else session.proc.kill('SIGHUP')
    } catch {
      // Already gone.
    }
    this.onChanged?.(conversationId)
  }

  /** Idle shells have no children; a running command usually does. */
  isBusy(tabId: string): boolean {
    const session = this.sessions.get(tabId)
    if (!session) return false
    return hasChildProcesses(session.proc.pid)
  }

  killForConversation(conversationId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.conversationId === conversationId) this.kill(session.id)
    }
  }

  /** True if any live PTY is bound to this conversation (user bash or CLI host). */
  hasConversation(conversationId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) return true
    }
    return false
  }

  killAll(): void {
    for (const session of [...this.sessions.values()]) this.kill(session.id)
  }
}

/**
 * Mutates `args` in place to carry ambient launch context without TTY paste.
 * Returns the temp file path when one was written (caller tracks for cleanup).
 */
function applyLaunchContext(
  args: string[],
  opts: PtyLaunchOptions
): { contextFile: string | null } {
  const text = opts.launchContext?.trim()
  if (!text) return { contextFile: null }
  const strategy = opts.contextLaunchStrategy ?? 'prompt-paste'
  // Only Claude gets silent ambient argv. Other strategies (prompt-paste) are
  // handled by the renderer after spawn/restore — never fake a user TTY turn here.
  if (strategy === 'claude-append-system-prompt-file') {
    const contextFile = join(tmpdir(), `vav-agent-context-${randomUUID()}.txt`)
    writeFileSync(contextFile, text, 'utf8')
    args.push('--append-system-prompt-file', contextFile)
    return { contextFile }
  }
  return { contextFile: null }
}
