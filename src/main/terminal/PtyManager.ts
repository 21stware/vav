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

interface PtySession {
  id: string
  conversationId: string
  proc: pty.IPty
  /** Temp context file for --append-system-prompt-file; deleted on exit. */
  contextFile?: string | null
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
    private onExit: (tabId: string) => void
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
    proc.onData((data) => this.onData(id, data))
    proc.onExit(() => {
      const session = this.sessions.get(id)
      if (session?.contextFile) {
        try {
          unlinkSync(session.contextFile)
        } catch {
          // temp cleanup is best-effort
        }
      }
      this.sessions.delete(id)
      this.onExit(id)
    })
    this.sessions.set(id, { id, conversationId, proc, contextFile })

    return id
  }

  write(tabId: string, data: string): void {
    this.sessions.get(tabId)?.proc.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    try {
      session.proc.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      // The process can exit between the renderer measuring and this call.
    }
  }

  kill(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (!session) return
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
  const strategy = opts.contextLaunchStrategy ?? 'none'
  if (strategy === 'claude-append-system-prompt-file') {
    const contextFile = join(tmpdir(), `vav-agent-context-${randomUUID()}.txt`)
    writeFileSync(contextFile, text, 'utf8')
    args.push('--append-system-prompt-file', contextFile)
    return { contextFile }
  }
  return { contextFile: null }
}
