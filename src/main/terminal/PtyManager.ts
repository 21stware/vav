import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { PtyActivityStatus, PtyListResult } from '@shared/ipc'
import type { ConversationPtyLayouts, ShellKind, TerminalLayoutNode } from '@shared/types'

const execFileAsync = promisify(execFile)
import type { AgentContextLaunchStrategy } from '@shared/agentContextInject'
import { shellPath } from './StickyShell'
import { loginPath, resolveAgentExecutable } from './loginPath'
import { planCliAgentSpawn } from './cliAgentSpawn'
import { unwrapAgentLaunch } from './unwrapAgentLaunch'
import { rememberHostGrid, spawnGrid } from './lastHostGrid'
import { ensureClaudeWorkspaceTrusted, isClaudeCodeBinary } from './claudeTrust'
import { readPtsName, signalPosixPtyForegroundGroup } from './posixPtyForegroundGroup'
import { SYNC_HOLD_MAX_MS, splitSynchronizedOutput } from '@shared/terminalSyncFrames'
import { ptyOutputImpliesRunning } from './ptyActivity'

interface GhostBash {
  id: string
  conversationId: string
  title: string
  cwd: string
  createdAt: number
  outputBuffer: string
}

const PERSIST_DEBOUNCE_MS = 400

type PersistedBashPane = {
  id: string
  conversationId: string
  title: string
  cwd: string
  createdAt: number
  alive: boolean
  output: string
}

type PtyPersistFile = {
  version: 1
  bash: PersistedBashPane[]
  layouts: Record<string, ConversationPtyLayouts>
}


const IS_WINDOWS = process.platform === 'win32'

/** Raw ring — used to reconstruct a single attach snapshot, not full history. */
const OUTPUT_BUFFER_CAP = 512 * 1024
/** Plain-shell attach: keep a short tail of line scrollback. */
const BASH_REPLAY_TAIL = 24 * 1024
/**
 * CLI agent attach without a clear/alt-screen marker: keep a modest tail so a
 * second window is not blank, without replaying a full TUI redraw storm.
 * (Herdr keeps a host-side screen buffer; this is the cheap equivalent.)
 */
const AGENT_REPLAY_TAIL = 48 * 1024
/**
 * Coalesce PTY→IPC bursts into short batches.
 * Bash stays snappy; agent TUIs redraw whole screens — 32ms is one frame.
 */
const BASH_DATA_COALESCE_MS = 8
const AGENT_DATA_COALESCE_MS = 32
/**
 * How often live PTYs are re-classified as running / idle.
 *
 * Reading the process table costs one `ps` on POSIX but a whole PowerShell
 * start-up on Windows, so Windows trades dot latency for not burning a core.
 */
const STATUS_POLL_MS = IS_WINDOWS ? 3000 : 1000
/**
 * Grace after the last stdout byte before an *agent* tab may be called idle.
 *
 * Covers a TUI that is repainting a spinner with no children, and the gap
 * between a command's last write and its exit. Bash must not use this —
 * keystroke echo would look like a running command.
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
  status: PtyActivityStatus
  purpose?: 'install'
  installAgentId?: string
}

interface PtySession {
  id: string
  conversationId: string
  proc: pty.IPty
  /** Temp context file for --append-system-prompt-file; deleted on exit. */
  contextFile?: string | null
  agentId: string | null
  /** Live display title (may follow foreground process for bash tabs). */
  title: string
  /** Idle/default title restored when no child process is running. */
  baseTitle: string
  /** When true, status polling must not replace {@link title}. */
  pinTitle?: boolean
  purpose?: 'install'
  installAgentId?: string
  /** Directory the PTY was spawned in (used to restore after VAV restart). */
  cwd: string
  createdAt: number
  /** Ring buffer of recent stdout for attach/replay. */
  outputBuffer: string
  appliedCols: number
  appliedRows: number
  /** Slave path (`/dev/ttys003`) so resize can SIGWINCH the foreground group. */
  ptsName?: string
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
  /** Keep `title` as-is (install jobs). Default bash titles follow the child. */
  pinTitle?: boolean
  purpose?: 'install'
  installAgentId?: string
  /** Replay this scrollback after spawn (VAV restart restore). */
  restoreOutput?: string
  /** Preserve original createdAt when restoring a pane. */
  createdAt?: number
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
 * clear / alternate-screen enter; otherwise a short tail.
 *
 * Mirrors Herdr's detach→reattach path: the process keeps running in main, and
 * a new viewer paints from host-held output rather than respawning the agent.
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

  const isCliAgent = !!agentId && agentId !== 'vav'
  const tail = isCliAgent ? AGENT_REPLAY_TAIL : BASH_REPLAY_TAIL
  if (buffer.length > tail) return buffer.slice(-tail)
  return buffer
}

/**
 * Stable primary pane id for a conversation's CLI agent host.
 *
 * Multi-window activate races must resolve to the same live process (Herdr
 * "ensure pane" semantics). Extra splits intentionally use random ids.
 */
export function primaryAgentPaneId(conversationId: string, agentId: string): string {
  return `agent-host:${agentId}:${conversationId}`
}

/**
 * TIOCSWINSZ often lands on `login(1)` / the job-control shell, which does
 * not forward SIGWINCH. Grok / OpenCode in a bash session are the tty's
 * foreground group (`tpgid`) — signal that, fall back to the root pid.
 */
function deliverForegroundWinch(session: PtySession): void {
  if (IS_WINDOWS) return
  const pid = session.proc.pid
  if (!pid) return
  signalPosixPtyForegroundGroup(pid, session.ptsName, 'SIGWINCH', () => {
    try {
      process.kill(pid, 'SIGWINCH')
    } catch {
      // Root may have already exited between resize and signal.
    }
  })
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

interface ProcRow {
  pid: number
  ppid: number
  comm: string
  args: string
}

const SHELLISH =
  /^(?:-?bash|-?zsh|-?sh|-?fish|-?dash|-?ksh|-?csh|-?tcsh|login|ssh|screen|tmux|nu|pwsh|powershell|cmd|conhost)(?:\.exe)?$/i

function isShellish(row: ProcRow): boolean {
  const base = row.comm.replace(/^\(|\)$/g, '').split(/[/\\]/).pop() || row.comm
  return SHELLISH.test(base)
}

/** Parse `ps -axo pid=,ppid=,command=` style lines. */
function parsePsRows(stdout: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const pid = Number.parseInt(m[1]!, 10)
    const ppid = Number.parseInt(m[2]!, 10)
    const args = m[3]!.trim()
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !args) continue
    const first = args.split(/\s+/)[0] || args
    const comm = first.split(/[/\\]/).pop() || first
    rows.push({ pid, ppid, comm, args })
  }
  return rows
}

async function listProcessRows(): Promise<ProcRow[]> {
  try {
    if (IS_WINDOWS) {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          // Pipe-separated: pid|ppid|name|commandline
          "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,(($_.CommandLine) -replace '[\\r\\n|]', ' ') }"
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 4000 }
      )
      const rows: ProcRow[] = []
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split('|')
        if (parts.length < 3) continue
        const pid = Number.parseInt(parts[0]!, 10)
        const ppid = Number.parseInt(parts[1]!, 10)
        const comm = (parts[2] || 'process').replace(/\.exe$/i, '')
        const args = parts.slice(3).join('|') || comm
        if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
        rows.push({ pid, ppid, comm, args })
      }
      return rows
    }
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 3000
    })
    return parsePsRows(stdout)
  } catch {
    return []
  }
}

function childrenByParent(rows: ProcRow[]): Map<number, ProcRow[]> {
  const map = new Map<number, ProcRow[]>()
  for (const row of rows) {
    const list = map.get(row.ppid)
    if (list) list.push(row)
    else map.set(row.ppid, [row])
  }
  return map
}

/** Walk the shell's process tree; prefer the deepest non-shell child. */
function foregroundProcess(
  shellPid: number,
  byParent: Map<number, ProcRow[]>
): ProcRow | null {
  let best: ProcRow | null = null
  const stack = [shellPid]
  const seen = new Set<number>()
  while (stack.length) {
    const pid = stack.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    const kids = byParent.get(pid) ?? []
    for (const kid of kids) {
      stack.push(kid.pid)
      if (!isShellish(kid)) best = kid
    }
  }
  return best
}

function collectTreePids(root: number, byParent: Map<number, ProcRow[]>): number[] {
  const out: number[] = []
  const stack = [root]
  const seen = new Set<number>()
  while (stack.length) {
    const pid = stack.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
    for (const kid of byParent.get(pid) ?? []) stack.push(kid.pid)
  }
  return out
}

/** pid → listening TCP ports (LISTEN). Empty on Windows / when lsof is missing. */
async function listeningPortsByPid(): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>()
  if (IS_WINDOWS) return map
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 2500 }
    )
    let pid = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        pid = Number.parseInt(line.slice(1), 10) || 0
      } else if (line.startsWith('n') && pid > 0) {
        const m = line.match(/:(\d+)\s*$/)
        if (!m) continue
        const port = Number.parseInt(m[1]!, 10)
        if (!Number.isFinite(port) || port <= 0) continue
        const list = map.get(pid) ?? []
        if (!list.includes(port)) list.push(port)
        map.set(pid, list)
      }
    }
  } catch {
    // lsof missing or denied — titles fall back to process name only.
  }
  return map
}

function extractPortFromArgs(args: string): number | null {
  const patterns = [
    /(?:--port| -p|--listen-port)[= ](\d{2,5})\b/i,
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d{2,5})\b/,
    /\bport[=:](\d{2,5})\b/i
  ]
  for (const re of patterns) {
    const m = args.match(re)
    if (m) {
      const n = Number.parseInt(m[1]!, 10)
      if (n >= 1 && n <= 65535) return n
    }
  }
  return null
}

/** Short label for tab chips: `vite :5173`, `node`, `python3`. */
function prettyProcessName(proc: ProcRow): string {
  const args = proc.args
  const lower = args.toLowerCase()
  // Common front-end / app servers — prefer product name over node/python.
  if (/\bvite\b/.test(lower)) return 'vite'
  if (/\bnext(?:-server|\.js|\b)/.test(lower)) return 'next'
  if (/\bnuxt\b/.test(lower)) return 'nuxt'
  if (/\bastro\b/.test(lower)) return 'astro'
  if (/\bwebpack\b/.test(lower)) return 'webpack'
  if (/\besbuild\b/.test(lower)) return 'esbuild'
  if (/\bparcel\b/.test(lower)) return 'parcel'
  if (/\breact-scripts\b/.test(lower)) return 'react'
  if (/\bdjango\b/.test(lower) || /\bmanage\.py\s+runserver\b/.test(lower)) return 'django'
  if (/\buvicorn\b/.test(lower)) return 'uvicorn'
  if (/\bgunicorn\b/.test(lower)) return 'gunicorn'
  if (/\bflask\b/.test(lower)) return 'flask'
  if (/\bhttp\.server\b/.test(lower)) return 'http.server'
  if (/\brails\b/.test(lower) || /\bpuma\b/.test(lower)) return 'rails'
  if (/\bdocker\b/.test(lower) && /\bcompose\b/.test(lower)) return 'compose'
  if (/\bnpm\b/.test(lower) && /\brun\b/.test(lower)) return 'npm'
  if (/\bpnpm\b/.test(lower)) return 'pnpm'
  if (/\byarn\b/.test(lower)) return 'yarn'
  if (/\bbun\b/.test(lower)) return 'bun'

  let name = proc.comm.replace(/^\(|\)$/g, '').replace(/\.exe$/i, '')
  name = name.split(/[/\\]/).pop() || name
  // node script.js → script when obvious
  if (/^node(?:js)?$/i.test(name)) {
    const m = args.match(
      /(?:^|[\\/ ])node(?:js)?(?:\.exe)?\s+(?:--[\w-]+(?:=[\w.-]+)?\s+)*(?:.*[\\/])?([\w.-]+\.m?js|[\w.-]+)/i
    )
    if (m?.[1] && !m[1].startsWith('-')) {
      return m[1].replace(/\.m?js$/i, '').slice(0, 18)
    }
  }
  return name.slice(0, 18) || 'process'
}

function formatBashTabTitle(
  proc: ProcRow | null,
  ports: number[],
  baseTitle: string
): string {
  if (!proc) return baseTitle
  const name = prettyProcessName(proc)
  const port = ports[0] ?? extractPortFromArgs(proc.args)
  if (port) return `${name} :${port}`
  return name
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
  /** When the current unclosed DEC 2026 / incomplete CSI tail started. */
  private syncHoldSince = new Map<string, number>()
  private bashFlushTimer: ReturnType<typeof setTimeout> | null = null
  private agentFlushTimer: ReturnType<typeof setTimeout> | null = null
  /** First agent chunk is flushed immediately; later bursts keep the 32ms batch. */
  private agentPrimed = new Set<string>()
  /** Runs only while at least one PTY is alive. */
  private statusTimer: ReturnType<typeof setInterval> | null = null
  /** Guards against a slow process-table read overlapping the next tick. */
  private statusPolling = false
  /** Throttle lsof (ports) relative to ps (process names). */
  private titlePollTick = 0
  private cachedListenPorts = new Map<number, number[]>()
  /** Exited bash tabs the user has not closed — survive hydrate and VAV restart. */
  private ghosts = new Map<string, GhostBash>()
  private persistPath: string | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  /** Skip persist mutations while shutting down (already flushed). */
  private persistFrozen = false
  private restoring = false

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
   * Re-classify every live PTY and refresh bash tab titles from the
   * foreground process (+ listen port when available).
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
        if (
          ptyOutputImpliesRunning(session.agentId) &&
          now - session.lastDataAt < OUTPUT_ACTIVE_MS
        ) {
          this.setStatus(session, 'running')
        } else {
          quiet.push(session)
        }
      }

      // One process-table snapshot serves busy checks + bash tab titles.
      const rows = await listProcessRows()
      const byParent = childrenByParent(rows)
      const parents = new Set<number>()
      for (const row of rows) {
        if (row.ppid > 0) parents.add(row.ppid)
      }

      for (const session of quiet) {
        if (this.sessions.get(session.id) !== session) continue
        this.setStatus(session, parents.has(session.proc.pid) ? 'running' : 'idle')
      }

      // lsof is heavier than ps — refresh ports every other tick (~2s macOS).
      this.titlePollTick += 1
      if (this.titlePollTick % 2 === 1 || this.cachedListenPorts.size === 0) {
        this.cachedListenPorts = await listeningPortsByPid()
      }

      const titleChanged = new Set<string>()
      for (const session of this.sessions.values()) {
        // Only tools-tray bash (not CLI agents / VAV mirror / pinned install).
        if (session.agentId != null || session.pinTitle) continue
        const proc = foregroundProcess(session.proc.pid, byParent)
        const tree = collectTreePids(session.proc.pid, byParent)
        const ports: number[] = []
        for (const pid of tree) {
          for (const p of this.cachedListenPorts.get(pid) ?? []) {
            if (!ports.includes(p)) ports.push(p)
          }
        }
        ports.sort((a, b) => a - b)
        const next = formatBashTabTitle(proc, ports, session.baseTitle)
        if (next !== session.title) {
          session.title = next
          titleChanged.add(session.conversationId)
        }
      }
      for (const conversationId of titleChanged) {
        this.onChanged?.(conversationId)
      }
      if (titleChanged.size > 0) this.schedulePersist()
    } finally {
      this.statusPolling = false
    }
  }

  /** Conversation that owns a live tab (for targeted IPC). */
  conversationIdFor(tabId: string): string | null {
    return this.sessions.get(tabId)?.conversationId ?? this.ghosts.get(tabId)?.conversationId ?? null
  }

  /**
   * True when {@link create} would attach an existing process instead of spawn.
   * Callers that mint resume argv must skip that work on attach.
   */
  willAttachCreate(conversationId: string, options?: PtyLaunchOptions | string): boolean {
    const opts: PtyLaunchOptions =
      typeof options === 'string' ? { preferredId: options } : (options ?? {})
    const preferredId = opts.preferredId
    const agentId =
      opts.agentId !== undefined ? opts.agentId : preferredId === 'agent' ? 'vav' : null
    if (preferredId && this.sessions.has(preferredId)) return true
    if (
      preferredId &&
      agentId &&
      agentId !== 'vav' &&
      opts.command?.trim() &&
      preferredId === primaryAgentPaneId(conversationId, agentId)
    ) {
      return this.findLiveAgentPane(conversationId, agentId) != null
    }
    return false
  }

  /**
   * Oldest live pane for a CLI agent host in this conversation.
   * Used to attach rather than respawn when preferredId was not supplied.
   */
  findLiveAgentPane(conversationId: string, agentId: string): string | null {
    let best: PtySession | null = null
    for (const session of this.sessions.values()) {
      if (session.conversationId !== conversationId) continue
      if (session.agentId !== agentId) continue
      if (!best || session.createdAt < best.createdAt) best = session
    }
    return best?.id ?? null
  }

  private isAgentPty(tabId: string): boolean {
    const agentId = this.sessions.get(tabId)?.agentId
    return !!agentId && agentId !== 'vav'
  }

  private enqueueData(tabId: string, data: string): void {
    const prev = this.pendingData.get(tabId)
    if (!prev) this.syncHoldSince.set(tabId, Date.now())
    this.pendingData.set(tabId, prev ? prev + data : data)
    const agent = this.isAgentPty(tabId)
    if (agent) {
      // Codex can emit a complete first frame in ~15ms; holding it for 32ms
      // is a visible blank. Still go through emitPending so an incomplete CSI
      // / unclosed DEC 2026 tail is not leaked to xterm.
      if (!this.agentPrimed.has(tabId)) {
        this.agentPrimed.add(tabId)
        const stillHolding = this.emitPending(tabId, false)
        if (stillHolding && this.agentFlushTimer == null) {
          this.agentFlushTimer = setTimeout(() => {
            this.agentFlushTimer = null
            this.flushPendingKind('agent')
          }, AGENT_DATA_COALESCE_MS)
        }
        return
      }
      if (this.agentFlushTimer != null) return
      this.agentFlushTimer = setTimeout(() => {
        this.agentFlushTimer = null
        this.flushPendingKind('agent')
      }, AGENT_DATA_COALESCE_MS)
      return
    }
    if (this.bashFlushTimer != null) return
    this.bashFlushTimer = setTimeout(() => {
      this.bashFlushTimer = null
      this.flushPendingKind('bash')
    }, BASH_DATA_COALESCE_MS)
  }

  private emitPending(tabId: string, force: boolean): boolean {
    const chunk = this.pendingData.get(tabId)
    if (chunk == null) return false
    const heldMs = force
      ? SYNC_HOLD_MAX_MS
      : Date.now() - (this.syncHoldSince.get(tabId) ?? Date.now())
    const { emit, hold } = splitSynchronizedOutput(chunk, heldMs)
    if (emit) this.onData(tabId, emit)
    if (hold) {
      this.pendingData.set(tabId, hold)
      return true
    }
    this.pendingData.delete(tabId)
    this.syncHoldSince.delete(tabId)
    return false
  }

  private flushPendingData(onlyTabId?: string): void {
    if (onlyTabId) {
      this.emitPending(onlyTabId, true)
      return
    }
    this.flushPendingKind('all')
  }

  private flushPendingKind(kind: 'agent' | 'bash' | 'all'): void {
    if (this.pendingData.size === 0) return
    let holdAgent = false
    let holdBash = false
    for (const tabId of [...this.pendingData.keys()]) {
      if (kind !== 'all') {
        const agent = this.isAgentPty(tabId)
        if (kind === 'agent' ? !agent : agent) continue
      }
      const stillHolding = this.emitPending(tabId, false)
      if (!stillHolding) continue
      if (this.isAgentPty(tabId)) holdAgent = true
      else holdBash = true
    }
    if (holdAgent && this.agentFlushTimer == null) {
      this.agentFlushTimer = setTimeout(() => {
        this.agentFlushTimer = null
        this.flushPendingKind('agent')
      }, AGENT_DATA_COALESCE_MS)
    }
    if (holdBash && this.bashFlushTimer == null) {
      this.bashFlushTimer = setTimeout(() => {
        this.bashFlushTimer = null
        this.flushPendingKind('bash')
      }, BASH_DATA_COALESCE_MS)
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
    // Prefer explicit agentId from the renderer; only special-case the legacy
    // vav mirror preferredId. Never infer from binary path (paths are not ids).
    const agentId =
      opts.agentId !== undefined
        ? opts.agentId
        : preferredId === 'agent'
          ? 'vav'
          : null
    // Stable preferredId is the multi-window ensure key (Herdr attach semantics).
    // Extra splits pass a fresh preferredId so the pane keeps a stable binding;
    // only the primary activate id may attach an older live process.
    if (preferredId && this.sessions.has(preferredId)) return preferredId
    if (
      preferredId &&
      agentId &&
      agentId !== 'vav' &&
      opts.command?.trim() &&
      preferredId === primaryAgentPaneId(conversationId, agentId)
    ) {
      const existing = this.findLiveAgentPane(conversationId, agentId)
      if (existing) return existing
    }
    const id = preferredId ?? randomUUID()
    // Number idle bash tabs so multi-shell trays stay distinguishable.
    const bashIndex =
      [...this.sessions.values()].filter((s) => s.agentId == null).length + 1
    const title =
      opts.title?.trim() ||
      (agentId && agentId !== 'vav'
        ? agentId
        : preferredId === 'agent'
          ? 'vav'
          : `bash-${bashIndex}`)
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
        // Skip npm/bash trampolines (Grok → ~/.grok/bin/grok, Cursor → bundled node).
        const unwrapped = unwrapAgentLaunch(resolved, agentArgs)
        Object.assign(baseEnv, unwrapped.env)
        // Absolute path (the resolve cache after boot warm): exec directly.
        // Login-shell wrap is only for a bare name the GUI PATH cannot see.
        const planned = planCliAgentSpawn({
          resolved: unwrapped.file,
          agentArgs: unwrapped.args,
          shell: shellPath(shell),
          isWindows: IS_WINDOWS
        })
        file = planned.file
        args = planned.args
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

    const grid = spawnGrid(cols, rows)
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: grid.cols,
      rows: grid.rows,
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
      baseTitle: title,
      pinTitle: opts.pinTitle === true || opts.purpose === 'install',
      purpose: opts.purpose,
      installAgentId: opts.installAgentId,
      cwd: safeCwd,
      createdAt: opts.createdAt ?? Date.now(),
      outputBuffer: opts.restoreOutput ?? '',
      appliedCols: grid.cols,
      appliedRows: grid.rows,
      ptsName: IS_WINDOWS ? undefined : readPtsName(proc),
      // Bash starts idle (prompt paint is not a command). Agent TUIs start
      // running until the first poll / quiet gap.
      lastDataAt: Date.now(),
      status: ptyOutputImpliesRunning(agentId) ? 'running' : 'idle'
    }
    proc.onData((data) => {
      appendOutputBuffer(session, data)
      session.lastDataAt = Date.now()
      if (ptyOutputImpliesRunning(session.agentId)) this.setStatus(session, 'running')
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
      this.agentPrimed.delete(id)
      this.sessions.delete(id)
      if (diedOnItsOwn) {
        if (session.agentId == null) {
          this.ghosts.set(id, {
            id,
            conversationId,
            title: session.title,
            cwd: session.cwd,
            createdAt: session.createdAt,
            outputBuffer: session.outputBuffer
          })
        }
        this.setStatus(session, 'exited')
        this.schedulePersist()
      }
      this.onExit(id, conversationId)
      this.onChanged?.(conversationId)
      if (this.sessions.size === 0) this.stopStatusPolling()
    })
    this.sessions.set(id, session)
    this.ghosts.delete(id)
    this.startStatusPolling()
    if (!this.restoring) this.onChanged?.(conversationId)
    if (agentId == null) this.schedulePersist()

    return id
  }

  /** Split trees for bash / CLI hosts — shared across main + detached windows. */
  private layouts = new Map<string, ConversationPtyLayouts>()

  /** Live PTY metadata + layouts for one conversation (stable across windows). */
  listForConversation(conversationId: string): PtyListResult {
    const out: PtySessionMeta[] = []
    for (const session of this.sessions.values()) {
      if (session.conversationId !== conversationId) continue
      out.push({
        id: session.id,
        conversationId: session.conversationId,
        agentId: session.agentId,
        title: session.title,
        createdAt: session.createdAt,
        status: session.status,
        purpose: session.purpose,
        installAgentId: session.installAgentId
      })
    }
    for (const ghost of this.ghosts.values()) {
      if (ghost.conversationId !== conversationId) continue
      out.push({
        id: ghost.id,
        conversationId: ghost.conversationId,
        agentId: null,
        title: ghost.title,
        createdAt: ghost.createdAt,
        status: 'exited'
      })
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return {
      sessions: out,
      layouts: cloneLayouts(this.layouts.get(conversationId))
    }
  }

  /**
   * Persist pane split directions/weights. Detached session windows hydrate
   * from this instead of inventing an all-`row` tree via layoutFromTabIds.
   * Notifies companions — pending-only pickers have no PTY, so kill/list
   * events alone never carry the reseeded layout.
   */
  setLayouts(conversationId: string, layouts: ConversationPtyLayouts): void {
    if (!conversationId) return
    const next: ConversationPtyLayouts = {
      bash: cloneLayout(layouts.bash),
      agents: Object.fromEntries(
        Object.entries(layouts.agents ?? {}).map(([id, node]) => [id, cloneLayout(node)])
      ),
      cliMode: layouts.cliMode === true
    }
    const prev = this.layouts.get(conversationId)
    this.layouts.set(conversationId, next)
    this.schedulePersist()
    if (JSON.stringify(prev ?? null) !== JSON.stringify(next)) {
      this.onChanged?.(conversationId)
    }
  }

  clearLayouts(conversationId: string): void {
    this.layouts.delete(conversationId)
  }

  /**
   * Snapshot for a newly attached xterm — last screen only for agent TUIs,
   * short tail for plain bash. Never the full redraw history.
   */
  replay(tabId: string): string {
    const session = this.sessions.get(tabId)
    if (session) return snapshotForReplay(session.outputBuffer, session.agentId)
    const ghost = this.ghosts.get(tabId)
    if (ghost) return snapshotForReplay(ghost.outputBuffer, null)
    return ''
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
      rememberHostGrid(c, r)
      deliverForegroundWinch(session)
    } catch {
      // Process may have exited between measure and apply.
    }
  }

  /** No-op kept for window-close callers; size is driven only by focused fit. */
  releaseViewer(_viewerId: number): void {
    // intentionally empty
  }

  kill(tabId: string): void {
    const ghost = this.ghosts.get(tabId)
    if (ghost) {
      this.ghosts.delete(tabId)
      this.schedulePersist()
      this.onChanged?.(ghost.conversationId)
      return
    }
    const session = this.sessions.get(tabId)
    if (!session) return
    const conversationId = session.conversationId
    this.flushPendingData(tabId)
    this.agentPrimed.delete(tabId)
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
    if (!this.persistFrozen) this.schedulePersist()
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
    for (const ghost of [...this.ghosts.values()]) {
      if (ghost.conversationId === conversationId) this.kill(ghost.id)
    }
    this.clearLayouts(conversationId)
    this.schedulePersist()
  }

  /** True if any live PTY or bash tombstone is bound to this conversation. */
  hasConversation(conversationId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) return true
    }
    for (const ghost of this.ghosts.values()) {
      if (ghost.conversationId === conversationId) return true
    }
    return false
  }

  /**
   * Live CLI agent pane used for Swarm finish-watch (not bash, not VAV mirror).
   * Call only while the session is still registered — `exited` is emitted after delete.
   */
  cliAgentWatchTarget(tabId: string): {
    id: string
    conversationId: string
    agentId: string
    createdAt: number
    lastDataAt: number
    status: PtyActivityStatus
  } | null {
    const session = this.sessions.get(tabId)
    if (!session?.agentId || session.agentId === 'vav') return null
    return {
      id: session.id,
      conversationId: session.conversationId,
      agentId: session.agentId,
      createdAt: session.createdAt,
      lastDataAt: session.lastDataAt,
      status: session.status
    }
  }

  /**
   * Live CLI agent host panes (excludes plain bash and the built-in VAV mirror).
   */
  listCliAgentSessions(): PtySessionMeta[] {
    const out: PtySessionMeta[] = []
    for (const session of this.sessions.values()) {
      if (!session.agentId || session.agentId === 'vav') continue
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

  /** Live tools-tray bash panes (not VAV mirror, not CLI agents). */
  listBashSessions(): PtySessionMeta[] {
    const out: PtySessionMeta[] = []
    for (const session of this.sessions.values()) {
      if (session.agentId != null) continue
      out.push({
        id: session.id,
        conversationId: session.conversationId,
        agentId: null,
        title: session.title,
        createdAt: session.createdAt,
        status: session.status,
        purpose: session.purpose,
        installAgentId: session.installAgentId
      })
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return out
  }

  /**
   * Restore bash panes after a VAV restart: live shells respawn in the same
   * slot; already-exited tabs come back as tombstones (same as process exit).
   */
  restorePersisted(opts: {
    persistPath: string
    shell: ShellKind
    conversationExists: (id: string) => boolean
    restoreMarker: string
  }): void {
    this.persistPath = opts.persistPath
    const file = this.readPersistFile()
    if (!file) return
    this.restoring = true
    try {
      for (const [conversationId, layouts] of Object.entries(file.layouts ?? {})) {
        if (!opts.conversationExists(conversationId)) continue
        // Only bash splits survive a restart — CLI hosts are not respawned.
        this.layouts.set(conversationId, {
          bash: cloneLayout(layouts.bash),
          agents: {},
          cliMode: false
        })
      }
      for (const pane of file.bash ?? []) {
        if (!pane?.id || !opts.conversationExists(pane.conversationId)) continue
        if (this.sessions.has(pane.id) || this.ghosts.has(pane.id)) continue
        const cwd = pane.cwd && existsSync(pane.cwd) ? pane.cwd : homedir()
        const output = typeof pane.output === 'string' ? pane.output : ''
        if (pane.alive === false) {
          this.ghosts.set(pane.id, {
            id: pane.id,
            conversationId: pane.conversationId,
            title: pane.title || 'bash',
            cwd,
            createdAt: pane.createdAt || Date.now(),
            outputBuffer: output
          })
          continue
        }
        const marker = opts.restoreMarker
          ? `\r\n\x1b[2m${opts.restoreMarker}\x1b[0m\r\n`
          : ''
        try {
          this.create(pane.conversationId, opts.shell, cwd, 80, 24, {
            preferredId: pane.id,
            agentId: null,
            title: pane.title || 'bash',
            createdAt: pane.createdAt,
            restoreOutput: `${output}${marker}`
          })
        } catch (err) {
          console.warn('[pty] restore spawn failed', pane.id, err)
        }
      }
    } finally {
      this.restoring = false
    }
    const changed = new Set<string>()
    for (const session of this.sessions.values()) {
      if (session.agentId == null) changed.add(session.conversationId)
    }
    for (const ghost of this.ghosts.values()) changed.add(ghost.conversationId)
    for (const conversationId of changed) this.onChanged?.(conversationId)
    this.schedulePersist()
  }

  /** Write live bash + tombstones now (call from before-quit before killAll). */
  flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.writePersistFile()
  }

  killAll(): void {
    this.flushPersist()
    this.persistFrozen = true
    for (const session of [...this.sessions.values()]) this.kill(session.id)
    this.layouts.clear()
  }

  private schedulePersist(): void {
    if (this.persistFrozen || this.restoring || !this.persistPath) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.writePersistFile()
    }, PERSIST_DEBOUNCE_MS)
  }

  private readPersistFile(): PtyPersistFile | null {
    if (!this.persistPath || !existsSync(this.persistPath)) return null
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf8')) as PtyPersistFile
      if (!raw || raw.version !== 1 || !Array.isArray(raw.bash)) return null
      return raw
    } catch {
      return null
    }
  }

  private writePersistFile(): void {
    if (!this.persistPath || this.persistFrozen) return
    const bash: PersistedBashPane[] = []
    for (const session of this.sessions.values()) {
      if (session.agentId != null) continue
      bash.push({
        id: session.id,
        conversationId: session.conversationId,
        title: session.title,
        cwd: session.cwd,
        createdAt: session.createdAt,
        alive: true,
        output: session.outputBuffer.slice(-BASH_REPLAY_TAIL)
      })
    }
    for (const ghost of this.ghosts.values()) {
      bash.push({
        id: ghost.id,
        conversationId: ghost.conversationId,
        title: ghost.title,
        cwd: ghost.cwd,
        createdAt: ghost.createdAt,
        alive: false,
        output: ghost.outputBuffer.slice(-BASH_REPLAY_TAIL)
      })
    }
    const layouts: Record<string, ConversationPtyLayouts> = {}
    for (const [id, node] of this.layouts) layouts[id] = cloneLayouts(node)
    const body: PtyPersistFile = { version: 1, bash, layouts }
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true })
      writeFileSync(this.persistPath, JSON.stringify(body), 'utf8')
    } catch (err) {
      console.warn('[pty] persist failed', err)
    }
  }
}

function cloneLayout(node: TerminalLayoutNode | null | undefined): TerminalLayoutNode | null {
  if (!node) return null
  if (node.type === 'leaf') {
    return { type: 'leaf', tabId: node.tabId, weight: node.weight }
  }
  return {
    type: 'branch',
    direction: node.direction === 'column' ? 'column' : 'row',
    weight: node.weight,
    children: [cloneLayout(node.children[0])!, cloneLayout(node.children[1])!]
  }
}

function cloneLayouts(layouts: ConversationPtyLayouts | undefined): ConversationPtyLayouts {
  if (!layouts) return { bash: null, agents: {}, cliMode: false }
  return {
    bash: cloneLayout(layouts.bash),
    agents: Object.fromEntries(
      Object.entries(layouts.agents ?? {}).map(([id, node]) => [id, cloneLayout(node)])
    ),
    cliMode: layouts.cliMode === true
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
