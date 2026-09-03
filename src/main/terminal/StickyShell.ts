import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ShellKind } from '@shared/types'
import { localHostProcess, type HostChild, type HostProcess } from '../host/HostProcess.ts'
import { agentShellEnv } from './agentShellEnv'
import { appendCapped } from './bufferCap.ts'

const IS_WINDOWS = process.platform === 'win32'

export function shellPath(kind: ShellKind): string {
  switch (kind) {
    case 'zsh':
      return '/bin/zsh'
    case 'bash':
      return '/bin/bash'
    case 'fish':
      return '/opt/homebrew/bin/fish'
    case 'powershell':
      return 'powershell.exe'
  }
}

/**
 * Arguments that put the shell in "read a script from stdin" mode, which is
 * what the sticky session is: one process, an unbounded stream of commands.
 */
function stdinArgs(kind: ShellKind): string[] {
  return kind === 'powershell'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']
    : ['-s']
}

function oneShotArgs(kind: ShellKind, command: string): string[] {
  return kind === 'powershell'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['-c', command]
}

/**
 * Windows PowerShell writes to a pipe in the console's OEM code page, which
 * turns every non-ASCII byte of a command's output into mojibake once we read
 * it back as UTF-8. Nothing but the session's first line can fix that.
 */
const POWERSHELL_PREAMBLE = [
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$ProgressPreference = "SilentlyContinue"',
  ''
].join('\n')

/**
 * Take down a command's whole process tree.
 *
 * On POSIX the shell owns its process group, so one signal reaches everything
 * it started. Windows has no process groups worth the name; `taskkill /T` walks
 * the parent chain instead.
 */
function killTree(pid: number, fallback: () => void): void {
  if (IS_WINDOWS) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).unref()
    } catch {
      fallback()
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    fallback()
  }
}

export interface CommandResult {
  output: string
  exitCode: number
  timedOut: boolean
  /** True when the sticky session was unavailable and a one-shot ran instead. */
  usedFallback: boolean
  /** Set when the command was detached and is still running after settle. */
  backgroundPid?: number
  /** Stop / abort killed the command before it exited on its own. */
  cancelled?: boolean
}

export type ShellOutputHandler = (chunk: string) => void

/** Stable id the model uses with `wait` / `read_bash_session`. */
export const BASH_SESSION_ID = 'bash'

/** How long a backgrounded server may stream before we return to the agent. */
const BACKGROUND_SETTLE_MS = 4_000

/** Cap scrollback kept for `read_bash_session` / `wait`. */
const SESSION_SCROLLBACK_CHARS = 200_000

export interface WaitResult {
  matched: boolean
  output: string
  elapsedMs: number
  cancelled?: boolean
}

/**
 * The agent's command executor: one long-lived shell per conversation, so cwd,
 * exported vars and shell history persist across tool calls (README §2.4).
 *
 * Commands are framed with a unique end marker written by the shell itself.
 * Reading until that marker is what lets a single stdin pipe carry an unbounded
 * sequence of commands without re-spawning. stderr is folded into stdout so the
 * captured transcript matches what a terminal would have shown.
 *
 * This is deliberately *not* the interactive PTY the user sees; that one is a
 * display surface (see terminal-panel.rpml, "双轨终端").
 */
export class StickyShell {
  private child: HostChild | null = null
  private buffer = ''
  private cwd: string
  private queue: Promise<unknown> = Promise.resolve()
  /** Active command's stdout/stderr appender; stderr from spawn routes here. */
  private appendChunk: ((chunk: string) => void) | null = null
  /** Full session transcript for wait / read_bash_session. */
  private scrollback = ''
  private backgroundChild: HostChild | null = null
  /** Why the current command/wait is being torn down, if we initiated it. */
  private stopReason: 'timeout' | 'cancel' | null = null
  /** Active `waitFor` resolver — Stop must unblock it, not only kill the PTY. */
  private waitCancel: (() => void) | null = null
  /** Fallback one-shot child when the sticky session cannot start. */
  private oneShotChild: HostChild | null = null

  readonly sessionId = BASH_SESSION_ID

  constructor(
    private shell: ShellKind,
    cwd: string,
    private hostProcess: HostProcess = localHostProcess
  ) {
    this.cwd = cwd
  }

  private recordSession(chunk: string): void {
    if (!chunk) return
    this.scrollback += chunk
    if (this.scrollback.length > SESSION_SCROLLBACK_CHARS) {
      this.scrollback = this.scrollback.slice(-SESSION_SCROLLBACK_CHARS)
    }
  }

  /** Last N lines of the session scrollback (default 200). */
  readTail(tailLines = 200): string {
    const lines = this.scrollback.split('\n')
    const n = Math.max(1, Math.min(10_000, Math.round(tailLines)))
    return lines.slice(-n).join('\n')
  }

  /**
   * Block until `expect` appears in new session output, or timeout.
   * Matching is against output appended after this call starts.
   */
  waitFor(expect: string, timeoutMs = 60_000, signal?: AbortSignal): Promise<WaitResult> {
    const pattern = expect.trim()
    if (!pattern) {
      return Promise.resolve({ matched: false, output: '', elapsedMs: 0 })
    }
    const startedAt = Date.now()
    const baseline = this.scrollback.length
    let regex: RegExp | null = null
    try {
      regex = new RegExp(pattern)
    } catch {
      // Treat as literal substring when the model passes an invalid regex.
    }

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setInterval> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const done = (result: WaitResult): void => {
        if (settled) return
        settled = true
        if (this.waitCancel === cancel) this.waitCancel = null
        signal?.removeEventListener('abort', cancel)
        if (timer) clearInterval(timer)
        if (timeout) clearTimeout(timeout)
        resolve(result)
      }
      const cancel = (): void => {
        done({
          matched: false,
          output: this.scrollback.slice(baseline),
          elapsedMs: Date.now() - startedAt,
          cancelled: true
        })
      }
      const check = (): boolean => {
        const slice = this.scrollback.slice(baseline)
        const matched = regex ? regex.test(slice) : slice.includes(pattern)
        if (!matched) return false
        done({ matched: true, output: slice, elapsedMs: Date.now() - startedAt })
        return true
      }
      this.waitCancel = cancel
      if (signal?.aborted) {
        cancel()
        return
      }
      signal?.addEventListener('abort', cancel, { once: true })
      if (check()) return
      timer = setInterval(() => void check(), 150)
      timeout = setTimeout(() => {
        done({
          matched: false,
          output: this.scrollback.slice(baseline),
          elapsedMs: Date.now() - startedAt
        })
      }, Math.max(100, timeoutMs))
    })
  }

  setWorkingDirectory(cwd: string): void {
    if (cwd === this.cwd) return
    this.cwd = cwd
    // Cheaper than re-spawning, and keeps exported vars from earlier tool calls.
    if (this.child?.stdin) this.child.stdin.write(this.changeDirectory(cwd))
  }

  private changeDirectory(cwd: string): string {
    switch (this.shell) {
      case 'powershell':
        return `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'\n`
      default:
        return `cd ${quote(cwd)}\n`
    }
  }

  setShell(shell: ShellKind): void {
    if (shell === this.shell) return
    this.shell = shell
    this.dispose()
  }

  private tapOutput(onOutput?: ShellOutputHandler): ShellOutputHandler {
    return (chunk) => {
      this.recordSession(chunk)
      onOutput?.(chunk)
    }
  }

  /** Serialises commands: one sticky shell can only run one at a time. */
  run(
    command: string,
    timeoutSeconds: number,
    onOutput?: ShellOutputHandler,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    const task = this.queue.then(() =>
      this.execute(command, timeoutSeconds, this.tapOutput(onOutput), signal)
    )
    this.queue = task.catch(() => undefined)
    return task
  }

  /**
   * Start a long-lived process (dev servers, watchers) without blocking the turn.
   *
   * Runs outside the sticky shell so a later timeout cannot kill it, streams
   * startup output for a short settle window, then returns while it keeps going.
   * Further stdout still feeds the session scrollback for `wait` / `read_bash_session`.
   */
  runBackground(
    command: string,
    onOutput?: ShellOutputHandler,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    const task = this.queue.then(() =>
      this.executeBackground(command, this.tapOutput(onOutput), signal)
    )
    this.queue = task.catch(() => undefined)
    return task
  }

  /**
   * Stop the in-flight command / wait and kill the process tree.
   * The sticky session respawns on the next `run`.
   */
  interrupt(): void {
    this.stopReason = this.stopReason ?? 'cancel'
    this.waitCancel?.()
    this.dispose()
  }

  private executeBackground(
    command: string,
    onOutput?: ShellOutputHandler,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    if (signal?.aborted) {
      return Promise.resolve({
        output: '',
        exitCode: 130,
        timedOut: false,
        usedFallback: true,
        cancelled: true
      })
    }
    return new Promise((resolve) => {
      // Prefer a single tracked background child so wait/read keep receiving output.
      if (this.backgroundChild) {
        try {
          this.backgroundChild.unref()
        } catch {
          // ignore
        }
      }

      const child = this.hostProcess.spawn(
        shellPath(this.shell),
        oneShotArgs(this.shell, command),
        {
          cwd: this.cwd,
          env: agentShellEnv(),
          detached: !IS_WINDOWS,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      this.backgroundChild = child

      let output = ''
      let settled = false
      let exited = false

      const take = (chunk: string | Buffer): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        output += text
        // Always record — including after settle — so wait can match "listening".
        onOutput?.(text)
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', take)
      child.stderr?.on('data', take)

      const finish = (result: CommandResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      const onAbort = (): void => {
        this.stopReason = 'cancel'
        if (child.pid) killTree(child.pid, () => child.kill('SIGKILL'))
        if (this.backgroundChild === child) this.backgroundChild = null
        finish({
          output: output.replace(/\n$/, ''),
          exitCode: 130,
          timedOut: false,
          usedFallback: true,
          cancelled: true
        })
      }

      child.on('error', (err) => {
        exited = true
        if (this.backgroundChild === child) this.backgroundChild = null
        finish({
          output: `无法启动后台命令：${err.message}`,
          exitCode: 127,
          timedOut: false,
          usedFallback: true
        })
      })

      child.on('close', (code) => {
        exited = true
        if (this.backgroundChild === child) this.backgroundChild = null
        // Still within the settle window — treat as a normal short command.
        if (!settled) {
          finish({
            output: output.replace(/\n$/, ''),
            exitCode: this.stopReason === 'cancel' ? 130 : (code ?? -1),
            timedOut: false,
            usedFallback: true,
            cancelled: this.stopReason === 'cancel'
          })
        }
      })

      signal?.addEventListener('abort', onAbort, { once: true })

      const timer = setTimeout(() => {
        if (exited) return
        // Detach from our lifetime; the process group keeps running.
        try {
          child.unref()
        } catch {
          // ignore
        }
        const pid = child.pid
        const banner =
          `\n[background] pid=${pid ?? '?'} still running after ${BACKGROUND_SETTLE_MS / 1000}s` +
          `\n[background] use wait / read_bash_session to follow output; stop with kill ${pid ?? '<pid>'}`
        onOutput?.(banner + '\n')
        finish({
          output: (output + banner).replace(/\n$/, ''),
          exitCode: 0,
          timedOut: false,
          usedFallback: true,
          backgroundPid: pid
        })
      }, BACKGROUND_SETTLE_MS)
    })
  }

  private async execute(
    command: string,
    timeoutSeconds: number,
    onOutput?: ShellOutputHandler,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    if (signal?.aborted) {
      return {
        output: '',
        exitCode: 130,
        timedOut: false,
        usedFallback: false,
        cancelled: true
      }
    }
    if (!this.child) {
      try {
        this.spawnShell()
      } catch {
        return this.oneShot(command, timeoutSeconds, onOutput, signal)
      }
    }
    const child = this.child
    const stdin = child?.stdin
    const stdout = child?.stdout
    if (!child || !stdin || !stdout) {
      return this.oneShot(command, timeoutSeconds, onOutput, signal)
    }

    const marker = `<<<VAV_END:${randomUUID()}`
    const endPattern = new RegExp(`${escapeRegex(marker)}:(-?\\d+)>>>`)
    // Hold back a suffix long enough that a marker split across chunks cannot
    // leak into the mirrored transcript or be missed.
    const holdback = marker.length + 16
    this.buffer = ''
    this.stopReason = null
    let emitted = 0

    return new Promise<CommandResult>((resolve) => {
      let settled = false
      const finish = (result: CommandResult): void => {
        if (settled) return
        settled = true
        this.appendChunk = null
        this.stopReason = null
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        stdout.off('data', onData)
        child.off('exit', onExit)
        resolve(result)
      }

      const emitSafe = (): void => {
        if (!onOutput) return
        const safeEnd = Math.max(emitted, this.buffer.length - holdback)
        if (safeEnd <= emitted) return
        onOutput(this.buffer.slice(emitted, safeEnd))
        emitted = safeEnd
      }

      const onData = (chunk: string | Buffer): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        const capped = appendCapped(this.buffer, text)
        this.buffer = capped.buffer
        if (capped.dropped) emitted = Math.max(0, emitted - capped.dropped)
        const match = endPattern.exec(this.buffer)
        if (!match) {
          emitSafe()
          return
        }
        const output = this.buffer.slice(0, match.index)
        if (onOutput && emitted < output.length) onOutput(output.slice(emitted))
        this.buffer = ''
        emitted = 0
        finish({
          output: output.replace(/\n$/, ''),
          exitCode: Number(match[1]),
          timedOut: false,
          usedFallback: false
        })
      }

      this.appendChunk = onData

      const flushedPartial = (): string => {
        const output = this.buffer
        if (onOutput && emitted < output.length) onOutput(output.slice(emitted))
        this.buffer = ''
        emitted = 0
        return output
      }

      const onExit = (): void => {
        const output = flushedPartial()
        this.child = null
        const cancelled = this.stopReason === 'cancel'
        finish({
          output,
          exitCode: cancelled ? 130 : this.stopReason === 'timeout' ? 124 : -1,
          timedOut: this.stopReason === 'timeout',
          usedFallback: false,
          cancelled
        })
      }

      const onAbort = (): void => {
        this.stopReason = 'cancel'
        this.dispose()
      }

      const timer = setTimeout(() => {
        const partial = flushedPartial()
        // The command owns the process group; tearing it down is the only way to
        // reliably stop a wedged child, so the session restarts on the next call.
        this.stopReason = 'timeout'
        this.dispose()
        finish({
          output: partial,
          exitCode: 124,
          timedOut: true,
          usedFallback: false
        })
      }, timeoutSeconds * 1000)

      stdout.on('data', onData)
      child.once('exit', onExit)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const ok = stdin.write(this.frame(command, marker))
        if (!ok) {
          // Backpressure: still wait for drain or exit/timeout.
          stdin.once('drain', () => {})
        }
      } catch (err) {
        this.child = null
        finish({
          output: `无法向 shell 写入命令：${(err as Error).message}`,
          exitCode: 127,
          timedOut: false,
          usedFallback: false
        })
      }
    })
  }

  /**
   * Wraps a command so the shell reports its own completion and exit status.
   *
   * POSIX frames redirect the command's stdin from `/dev/null` so a tool that
   * reads stdin (`cat`, interactive npm, `read`, …) cannot swallow the end
   * marker that follows on the sticky shell's script stream. Heredocs still
   * work — the shell parses them from the script, not from the command's stdin.
   */
  private frame(command: string, marker: string): string {
    switch (this.shell) {
      case 'fish':
        return `begin\n${command}\nend </dev/null 2>&1\nprintf '\\n${marker}:%d>>>\\n' $status\n`
      case 'powershell':
        // PowerShell splits its failure signal in two: `$?` covers cmdlets,
        // `$LASTEXITCODE` covers native executables. Reset the latter first so
        // a stale code from an earlier command cannot be read as this one's.
        // (PowerShell has no `<` redirect; stdin starvation is a POSIX concern.)
        return [
          '$global:LASTEXITCODE = 0',
          `& {\n${command}\n} 2>&1 | Out-String -Stream`,
          'if (-not $? -and $global:LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }',
          `Write-Output "\`n${marker}:$($global:LASTEXITCODE)>>>"`,
          ''
        ].join('\n')
      default:
        // bash/zsh: run command, then print end marker with exit status.
        // Must emit exactly: printf '...\n' "$?"  — never "$?\" (unclosed quote hang).
        return `{\n${command}\n} </dev/null 2>&1\nprintf '\\n${marker}:%d>>>\\n' ` + '"$?"\n'
    }
  }

  private spawnShell(): void {
    const child = this.hostProcess.spawn(shellPath(this.shell), stdinArgs(this.shell), {
      cwd: this.cwd,
      env: agentShellEnv(),
      // Own process group, so a timeout can take the whole command tree down.
      detached: !IS_WINDOWS,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error('host process is missing piped stdio')
    }

    child.on('error', () => {
      this.child = null
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string | Buffer) => {
      // Only shell-level noise reaches here; command stderr is folded into stdout.
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (this.appendChunk) this.appendChunk(text)
      else {
        const capped = appendCapped(this.buffer, text)
        this.buffer = capped.buffer
      }
    })
    child.stdout.setEncoding('utf8')
    this.child = child
    if (this.shell === 'powershell') child.stdin.write(POWERSHELL_PREAMBLE)
  }

  /** Used when the configured shell cannot start a sticky session at all. */
  private oneShot(
    command: string,
    timeoutSeconds: number,
    onOutput?: ShellOutputHandler,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    if (signal?.aborted) {
      return Promise.resolve({
        output: '',
        exitCode: 130,
        timedOut: false,
        usedFallback: true,
        cancelled: true
      })
    }
    return new Promise((resolve) => {
      const child = this.hostProcess.spawn(shellPath(this.shell), oneShotArgs(this.shell, command), {
        cwd: this.cwd,
        env: agentShellEnv({ TERM: 'dumb' }),
        detached: !IS_WINDOWS,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.oneShotChild = child
      let output = ''
      let timedOut = false
      let cancelled = false
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid) killTree(child.pid, () => child.kill('SIGKILL'))
      }, timeoutSeconds * 1000)

      const take = (c: string | Buffer): void => {
        const text = typeof c === 'string' ? c : c.toString('utf8')
        output += text
        onOutput?.(text)
      }

      const onAbort = (): void => {
        cancelled = true
        this.stopReason = 'cancel'
        if (child.pid) killTree(child.pid, () => child.kill('SIGKILL'))
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', take)
      child.stderr?.on('data', take)
      child.on('error', (err) => {
        if (this.oneShotChild === child) this.oneShotChild = null
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve({
          output: `无法启动 ${shellPath(this.shell)}：${err.message}`,
          exitCode: 127,
          timedOut: false,
          usedFallback: true
        })
      })
      child.on('close', (code) => {
        if (this.oneShotChild === child) this.oneShotChild = null
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        const stopped = cancelled || this.stopReason === 'cancel'
        resolve({
          output: output.replace(/\n$/, ''),
          exitCode: timedOut ? 124 : stopped ? 130 : (code ?? -1),
          timedOut,
          usedFallback: true,
          cancelled: stopped && !timedOut
        })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  dispose(): void {
    const child = this.child
    this.child = null
    this.appendChunk = null
    this.buffer = ''
    const background = this.backgroundChild
    this.backgroundChild = null
    const oneShot = this.oneShotChild
    this.oneShotChild = null
    if (oneShot?.pid) {
      try {
        killTree(oneShot.pid, () => oneShot.kill('SIGKILL'))
      } catch {
        // ignore
      }
    }
    if (background?.pid) {
      try {
        killTree(background.pid, () => background.kill('SIGKILL'))
      } catch {
        // ignore
      }
    }
    if (!child?.pid) return
    killTree(child.pid, () => child.kill('SIGKILL'))
  }
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
