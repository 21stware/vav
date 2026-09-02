import { homedir } from 'node:os'
import { asHostStdioChild, localHostProcess, type HostProcess } from '../../host/HostProcess.ts'
import { loginPath } from '../../terminal/loginPath'
import { unwrapAgentLaunch } from '../../terminal/unwrapAgentLaunch'
import type { StdioProcess } from './stdioJson'

export type { StdioProcess } from './stdioJson'
export { asArray, asRecord, asString, dig, num, onJsonLines } from './stdioJson'
export { disposeStdioProcess } from './disposeStdio.ts'

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
      stdio: ['pipe', 'pipe', 'pipe']
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
        if (!child.killed) child.kill(signal ?? 'SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }
}
