import * as pty from 'node-pty'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ShellKind } from '@shared/types'
import { shellPath } from './StickyShell'

const IS_WINDOWS = process.platform === 'win32'

interface PtySession {
  id: string
  conversationId: string
  proc: pty.IPty
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
 * Interactive PTYs backing the user shell tabs.
 *
 * The Agent tab has no entry here — it is a read-only surface fed by
 * `mirrorAgentTranscript`, never a second live shell (terminal-panel.rpml).
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
    preferredId?: string
  ): string {
    if (preferredId && this.sessions.has(preferredId)) return preferredId
    const id = preferredId ?? randomUUID()
    const proc = pty.spawn(shellPath(shell), IS_WINDOWS ? ['-NoLogo'] : [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // ConPTY is what makes a Windows shell resizable and cursor-addressable
      // at all; without it node-pty falls back to winpty's line discipline.
      useConpty: IS_WINDOWS,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
    })
    proc.onData((data) => this.onData(id, data))
    proc.onExit(() => {
      this.sessions.delete(id)
      this.onExit(id)
    })
    this.sessions.set(id, { id, conversationId, proc })
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
