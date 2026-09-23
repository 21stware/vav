import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { asHostStdioChild, localHostProcess, type HostChild, type HostProcess } from '../../host/HostProcess.ts'
import { loginPath } from '../../terminal/loginPath'
import { unwrapAgentLaunch } from '../../terminal/unwrapAgentLaunch'
import type { StdioProcess } from './stdioJson'

export type { StdioProcess } from './stdioJson'
export { asArray, asRecord, asString, dig, num, onJsonLines } from './stdioJson'
export { disposeStdioProcess } from './disposeStdio.ts'

/** Node sets `killed` when the signal is sent, not when the process exits. */
export function isChildAlive(child: {
  exitCode?: number | null
  signalCode?: NodeJS.Signals | null
}): boolean {
  return child.exitCode == null && child.signalCode == null
}

export function killProcessTree(
  child: Pick<HostChild, 'pid' | 'kill'>,
  signal: NodeJS.Signals
): void {
  const pid = child.pid
  if (pid == null || pid <= 0) {
    child.kill(signal)
    return
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    child.kill(signal)
  }
}

export function spawnStdioProcess(
  binary: string,
  args: string[],
  cwd: string,
  envExtra?: Record<string, string>,
  hostProcess: HostProcess = localHostProcess
): StdioProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: loginPath(),
    HOME: process.env.HOME || homedir(),
    TERM: 'dumb',
    NO_COLOR: '1',
    ...envExtra
  }
  // Avoid forcing colours into NDJSON streams.
  delete env.FORCE_COLOR

  const unwrapped = unwrapAgentLaunch(binary, args)
  Object.assign(env, unwrapped.env)
  const child = asHostStdioChild(
    hostProcess.spawn(unwrapped.file, unwrapped.args, {
      cwd,
      env,
      argv0: unwrapped.argv0,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    })
  )

  return {
    child,
    writeLine(obj: unknown): void {
      if (!child.stdin.writable) return
      child.stdin.write(`${JSON.stringify(obj)}\n`)
    },
    writeRaw(text: string): void {
      if (!child.stdin.writable) return
      child.stdin.write(text)
    },
    closeStdin(): void {
      try {
        child.stdin.end()
      } catch {
        /* already closed */
      }
    },
    kill(signal?: NodeJS.Signals): void {
      try {
        if (!isChildAlive(child)) return
        killProcessTree(child, signal ?? 'SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }
}
