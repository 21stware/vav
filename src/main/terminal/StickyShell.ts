import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ShellKind } from '@shared/types'

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
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private cwd: string
  private queue: Promise<unknown> = Promise.resolve()
  /** Active command's stdout/stderr appender; stderr from spawn routes here. */
  private appendChunk: ((chunk: string) => void) | null = null
  /** Full session transcript for wait / read_bash_session. */
  private scrollback = ''
  private backgroundChild: ChildProcess | null = null

  readonly sessionId = BASH_SESSION_ID

  constructor(
    private shell: ShellKind,
    cwd: string
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
  waitFor(expect: string, timeoutMs = 60_000): Promise<WaitResult> {
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
      const check = (): boolean => {
        const slice = this.scrollback.slice(baseline)
        const matched = regex ? regex.test(slice) : slice.includes(pattern)
        if (!matched) return false
        clearInterval(timer)
        clearTimeout(timeout)
        resolve({ matched: true, output: slice, elapsedMs: Date.now() - startedAt })
        return true
      }
      if (check()) return
      const timer = setInterval(() => void check(), 150)
      const timeout = setTimeout(() => {
        clearInterval(timer)
        resolve({
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
    if (this.child) this.child.stdin.write(this.changeDirectory(cwd))
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
    onOutput?: ShellOutputHandler
  ): Promise<CommandResult> {
    const task = this.queue.then(() => this.execute(command, timeoutSeconds, this.tapOutput(onOutput)))
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
  runBackground(command: string, onOutput?: ShellOutputHandler): Promise<CommandResult> {
    const task = this.queue.then(() => this.executeBackground(command, this.tapOutput(onOutput)))
    this.queue = task.catch(() => undefined)
    return task
  }

  private executeBackground(
    command: string,
    onOutput?: ShellOutputHandler
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      // Prefer a single tracked background child so wait/read keep receiving output.
      if (this.backgroundChild) {
        try {
          this.backgroundChild.unref()
        } catch {
          // ignore
        }
      }

      const child: ChildProcess = spawn(
        shellPath(this.shell),
        oneShotArgs(this.shell, command),
        {
          cwd: this.cwd,
          env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' },
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
        resolve(result)
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
            exitCode: code ?? -1,
            timedOut: false,
            usedFallback: true
          })
        }
      })

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
    onOutput?: ShellOutputHandler
  ): Promise<CommandResult> {
    if (!this.child) {
      try {
        this.spawnShell()
      } catch {
        return this.oneShot(command, timeoutSeconds, onOutput)
      }
    }
    const child = this.child
    if (!child) return this.oneShot(command, timeoutSeconds, onOutput)

    const marker = `<<<VAV_END:${randomUUID()}`
    const endPattern = new RegExp(`${escapeRegex(marker)}:(-?\\d+)>>>`)
    // Hold back a suffix long enough that a marker split across chunks cannot
    // leak into the mirrored transcript or be missed.
    const holdback = marker.length + 16
    this.buffer = ''
    let emitted = 0

    return new Promise<CommandResult>((resolve) => {
      let settled = false
      const finish = (result: CommandResult): void => {
        if (settled) return
        settled = true
        this.appendChunk = null
        clearTimeout(timer)
        child.stdout.off('data', onData)
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
        this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
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

      const onExit = (): void => {
        const output = this.buffer
        if (onOutput && emitted < output.length) onOutput(output.slice(emitted))
        this.buffer = ''
        this.child = null
        finish({ output, exitCode: -1, timedOut: false, usedFallback: false })
      }

      const timer = setTimeout(() => {
        const partial = this.buffer
        if (onOutput && emitted < partial.length) onOutput(partial.slice(emitted))
        // The command owns the process group; tearing it down is the only way to
        // reliably stop a wedged child, so the session restarts on the next call.
        this.dispose()
        finish({
          output: partial,
          exitCode: 124,
          timedOut: true,
          usedFallback: false
        })
      }, timeoutSeconds * 1000)

      child.stdout.on('data', onData)
      child.once('exit', onExit)
      child.stdin.write(this.frame(command, marker))
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
        return `{\n${command}\n} </dev/null 2>&1\nprintf '\\n${marker}:%d>>>\\n' "$?\"\n`
    }
  }

  private spawnShell(): void {
    const child = spawn(shellPath(this.shell), stdinArgs(this.shell), {
      cwd: this.cwd,
      env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' },
      // Own process group, so a timeout can take the whole command tree down.
      detached: !IS_WINDOWS,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    child.on('error', () => {
      this.child = null
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string | Buffer) => {
      // Only shell-level noise reaches here; command stderr is folded into stdout.
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (this.appendChunk) this.appendChunk(text)
      else this.buffer += text
    })
    child.stdout.setEncoding('utf8')
    this.child = child
    if (this.shell === 'powershell') child.stdin.write(POWERSHELL_PREAMBLE)
  }

  /** Used when the configured shell cannot start a sticky session at all. */
  private oneShot(
    command: string,
    timeoutSeconds: number,
    onOutput?: ShellOutputHandler
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(shellPath(this.shell), oneShotArgs(this.shell, command), {
        cwd: this.cwd,
        env: { ...process.env, TERM: 'dumb' },
        detached: !IS_WINDOWS,
        windowsHide: true
      })
      let output = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid) killTree(child.pid, () => child.kill('SIGKILL'))
      }, timeoutSeconds * 1000)

      const take = (c: string | Buffer): void => {
        const text = typeof c === 'string' ? c : c.toString('utf8')
        output += text
        onOutput?.(text)
      }
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', take)
      child.stderr?.on('data', take)
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          output: `无法启动 ${shellPath(this.shell)}：${err.message}`,
          exitCode: 127,
          timedOut: false,
          usedFallback: true
        })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({
          output: output.replace(/\n$/, ''),
          exitCode: timedOut ? 124 : (code ?? -1),
          timedOut,
          usedFallback: true
        })
      })
    })
  }

  dispose(): void {
    const child = this.child
    this.child = null
    this.appendChunk = null
    this.buffer = ''
    const background = this.backgroundChild
    this.backgroundChild = null
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
