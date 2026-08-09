import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { PtyActivityStatus } from '@shared/ipc'
import type { ShellKind } from '@shared/types'

const execFileAsync = promisify(execFile)
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
 * Coalesce PTY→IPC bursts (TUI redraw storms) into short batches.
 * Keeps latency low for typing while cutting structured-clone fan-out.
 */
const DATA_COALESCE_MS = 8
/**
 * How often live PTYs are re-classified as running / idle.
 *
 * Reading the process table costs one `ps` on POSIX but a whole PowerShell
 * start-up on Windows, so Windows trades dot latency for not burning a core.
 */
const STATUS_POLL_MS = IS_WINDOWS ? 3000 : 1000
/**
 * Grace after the last stdout byte before a tab may be called idle.
 *
 * Covers the two things a child-process check cannot see: an agent TUI that is
 * repainting a spinner while it waits on the network (no children at all), and
 * the gap between a command's last write and its exit.
 */
const OUTPUT_ACTIVE_MS = 1200

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
  status: Exclude<PtyActivityStatus, 'exited'>
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
  /** Timestamp of the last stdout byte — the fast half of the busy check. */
  lastDataAt: number
  status: Exclude<PtyActivityStatus, 'exited'>
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



/**
 * Every parent pid on the machine, in one process spawn.
 *
 * The status poll asks "does this shell have a child?" for every live tab at
 * once, so per-tab `pgrep -P` would cost one exec per tab per second. One
 * table read answers all of them, and it is async so a slow `ps` cannot stall
 * the main process the way the old synchronous check did.
 */
async function activeParentPids(): Promise<Set<number>> {
  const pids = new Set<number>()
  try {
    const { stdout } = IS_WINDOWS
      ? await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            '(Get-CimInstance Win32_Process).ParentProcessId'
          ],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
        )
      : await execFileAsync('ps', ['-Ao', 'ppid='], {
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024
        })
    for (const line of stdout.split('\n')) {
      const value = Number.parseInt(line.trim(), 10)
      if (Number.isFinite(value) && value > 0) pids.add(value)
    }
  } catch {
    // Treat an unreadable process table as "nothing running" rather than
    // pinning every tab to a status it cannot leave.
  }
  return pids
}

/**
 * Interactive PTYs for user shells and CLI agent hosts.
 *
 * Sessions outlive tab switches and panel collapse; only conversation deletion
 * and app quit tear them down (README §2.6).
 */
export class PtyManager {
  private sessions = new Map<string, PtySession>()
  /** Pending stdout chunks waiting for the coalesce timer. */
  private pendingData = new Map<string, string>()
  private dataFlushTimer: ReturnType<typeof setTimeout> | null = null
  /** Runs only while at least one PTY is alive. */
  private statusTimer: ReturnType<typeof setInterval> | null = null
  /** Guards against a slow process-table read overlapping the next tick. */
  private statusPolling = false

  constructor(
    private onData: (tabId: string, data: string) => void,
    private onExit: (tabId: string, conversationId: string) => void,
    /** Fired after create / kill so every renderer can re-hydrate tab maps. */
    private onChanged?: (conversationId: string) => void,
    /** Running / idle / exited transitions for the terminal tab list. */
    private onStatus?: (
      tabId: string,
      conversationId: string,
      status: PtyActivityStatus
    ) => void
  ) {}

  /**
   * Publish a status only when it actually changed.
   *
   * `exited` is not stored — the session is about to be dropped, and the
   * renderer keeps the tab as a tombstone from this event alone.
   */
  private setStatus(session: PtySession, status: PtyActivityStatus): void {
    if (status !== 'exited') {
      if (session.status === status) return
      session.status = status
    }
    this.onStatus?.(session.id, session.conversationId, status)
  }

  private startStatusPolling(): void {
    if (this.statusTimer) return
    this.statusTimer = setInterval(() => void this.pollStatus(), STATUS_POLL_MS)
    // Status is a UI nicety; never hold the event loop open for it.
    this.statusTimer.unref?.()
  }

  private stopStatusPolling(): void {
    if (!this.statusTimer) return
    clearInterval(this.statusTimer)
    this.statusTimer = null
  }

  /**
   * Re-classify every live PTY.
   *
   * Recent stdout alone proves the tab is working, so the process table is
   * only consulted for the quiet ones — that is what catches a long build that
   * has stopped printing.
   */
  private async pollStatus(): Promise<void> {
    if (this.statusPolling) return
    if (this.sessions.size === 0) {
      this.stopStatusPolling()
      return
    }
    this.statusPolling = true
    try {
      const now = Date.now()
      const quiet: PtySession[] = []
      for (const session of this.sessions.values()) {
        if (now - session.lastDataAt < OUTPUT_ACTIVE_MS) this.setStatus(session, 'running')
        else quiet.push(session)
      }
      if (quiet.length === 0) return
      const parents = await activeParentPids()
      for (const session of quiet) {
        // Re-check liveness: the session may have exited during the await.
        if (this.sessions.get(session.id) !== session) continue
        this.setStatus(session, parents.has(session.proc.pid) ? 'running' : 'idle')
      }
    } finally {
      this.statusPolling = false
    }
  }

  /** Conversation that owns a live tab (for targeted IPC). */
  conversationIdFor(tabId: string): string | null {
    return this.sessions.get(tabId)?.conversationId ?? null
  }

  private enqueueData(tabId: string, data: string): void {
    const prev = this.pendingData.get(tabId)
    this.pendingData.set(tabId, prev ? prev + data : data)
    if (this.dataFlushTimer != null) return
    this.dataFlushTimer = setTimeout(() => {
      this.dataFlushTimer = null
      this.flushPendingData()
    }, DATA_COALESCE_MS)
  }

  private flushPendingData(onlyTabId?: string): void {
    if (onlyTabId) {
      const chunk = this.pendingData.get(onlyTabId)
      if (chunk == null) return
      this.pendingData.delete(onlyTabId)
      if (chunk) this.onData(onlyTabId, chunk)
      return
    }
    if (this.pendingData.size === 0) return
    const batch = this.pendingData
    this.pendingData = new Map()
    for (const [tabId, chunk] of batch) {
      if (chunk) this.onData(tabId, chunk)
    }
  }

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
      appliedRows: Math.max(1, rows),
      // A shell that just spawned is still painting its prompt; the first poll
      // settles it to idle a beat later.
      lastDataAt: Date.now(),
      status: 'running'
    }
    proc.onData((data) => {
      appendOutputBuffer(session, data)
      session.lastDataAt = Date.now()
      this.setStatus(session, 'running')
      this.enqueueData(id, data)
    })
    proc.onExit(() => {
      const current = this.sessions.get(id)
      // `kill()` unregisters before signalling, so a missing entry means the
      // user closed the tab. Only a process that died on its own earns a
      // tombstone — a closed tab should just disappear.
      const diedOnItsOwn = current === session
      if (current?.contextFile) {
        try {
          unlinkSync(current.contextFile)
        } catch {
          // temp cleanup is best-effort
        }
      }
      // Deliver any coalesced stdout before the exit marker.
      this.flushPendingData(id)
      this.sessions.delete(id)
      // Must precede onChanged: that triggers a re-hydrate from the live list,
      // and the renderer needs to know this tab is a tombstone before the
      // projection drops it.
      if (diedOnItsOwn) this.setStatus(session, 'exited')
      this.onExit(id, conversationId)
      this.onChanged?.(conversationId)
      if (this.sessions.size === 0) this.stopStatusPolling()
    })
    this.sessions.set(id, session)
    this.startStatusPolling()
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
        createdAt: session.createdAt,
        status: session.status
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
    this.flushPendingData(tabId)
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
  async isBusy(tabId: string): Promise<boolean> {
    const session = this.sessions.get(tabId)
    if (!session) return false
    const parents = await activeParentPids()
    return parents.has(session.proc.pid)
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
