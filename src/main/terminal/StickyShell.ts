import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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

  constructor(
    private shell: ShellKind,
    cwd: string
  ) {
    this.cwd = cwd
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

  /** Serialises commands: one sticky shell can only run one at a time. */
  run(command: string, timeoutSeconds: number): Promise<CommandResult> {
    const task = this.queue.then(() => this.execute(command, timeoutSeconds))
    this.queue = task.catch(() => undefined)
    return task
  }

  private async execute(command: string, timeoutSeconds: number): Promise<CommandResult> {
    if (!this.child) {
      try {
        this.spawnShell()
      } catch {
        return this.oneShot(command, timeoutSeconds)
      }
    }
    const child = this.child
    if (!child) return this.oneShot(command, timeoutSeconds)

    const marker = `<<<VAV_END:${randomUUID()}`
    const endPattern = new RegExp(`${escapeRegex(marker)}:(-?\\d+)>>>`)
    this.buffer = ''

    return new Promise<CommandResult>((resolve) => {
      let settled = false
      const finish = (result: CommandResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout.off('data', onData)
        child.off('exit', onExit)
        resolve(result)
      }

      const onData = (chunk: Buffer): void => {
        this.buffer += chunk.toString('utf8')
        const match = endPattern.exec(this.buffer)
        if (!match) return
        const output = this.buffer.slice(0, match.index)
        this.buffer = ''
        finish({
          output: output.replace(/\n$/, ''),
          exitCode: Number(match[1]),
          timedOut: false,
          usedFallback: false
        })
      }

      const onExit = (): void => {
        const output = this.buffer
        this.buffer = ''
        this.child = null
        finish({ output, exitCode: -1, timedOut: false, usedFallback: false })
      }

      const timer = setTimeout(() => {
        const partial = this.buffer
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

  /** Wraps a command so the shell reports its own completion and exit status. */
  private frame(command: string, marker: string): string {
    switch (this.shell) {
      case 'fish':
        return `begin\n${command}\nend 2>&1\nprintf '\\n${marker}:%d>>>\\n' $status\n`
      case 'powershell':
        // PowerShell splits its failure signal in two: `$?` covers cmdlets,
        // `$LASTEXITCODE` covers native executables. Reset the latter first so
        // a stale code from an earlier command cannot be read as this one's.
        return [
          '$global:LASTEXITCODE = 0',
          `& {\n${command}\n} 2>&1 | Out-String -Stream`,
          'if (-not $? -and $global:LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }',
          `Write-Output "\`n${marker}:$($global:LASTEXITCODE)>>>"`,
          ''
        ].join('\n')
      default:
        return `{\n${command}\n} 2>&1\nprintf '\\n${marker}:%d>>>\\n' "$?"\n`
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
    child.stderr.on('data', (chunk: Buffer) => {
      // Only shell-level noise reaches here; command stderr is folded into stdout.
      this.buffer += chunk.toString('utf8')
    })
    child.stdout.setEncoding('utf8')
    this.child = child
    if (this.shell === 'powershell') child.stdin.write(POWERSHELL_PREAMBLE)
  }

  /** Used when the configured shell cannot start a sticky session at all. */
  private oneShot(command: string, timeoutSeconds: number): Promise<CommandResult> {
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

      child.stdout?.on('data', (c: Buffer) => (output += c.toString('utf8')))
      child.stderr?.on('data', (c: Buffer) => (output += c.toString('utf8')))
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
    this.buffer = ''
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
