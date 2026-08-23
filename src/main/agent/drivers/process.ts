import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { loginPath } from '../../terminal/loginPath'
import { unwrapAgentLaunch } from '../../terminal/unwrapAgentLaunch'

export interface StdioProcess {
  child: ChildProcessWithoutNullStreams
  writeLine(obj: unknown): void
  writeRaw(text: string): void
  closeStdin(): void
  kill(): void
}

export function spawnStdioProcess(
  binary: string,
  args: string[],
  cwd: string,
  envExtra?: Record<string, string>
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
  const child = spawn(unwrapped.file, unwrapped.args, {
    cwd,
    env,
    argv0: unwrapped.argv0,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams

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
    kill(): void {
      try {
        if (!child.killed) child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }
}

/** Line-oriented JSON reader on a stream. */
export function onJsonLines(
  stream: NodeJS.ReadableStream,
  onLine: (value: unknown, raw: string) => void,
  onClose?: () => void
): void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      onLine(JSON.parse(trimmed) as unknown, trimmed)
    } catch {
      // Non-JSON noise (banners, progress) — ignore.
    }
  })
  rl.on('close', () => onClose?.())
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    const rec = asRecord(cur)
    if (!rec) return undefined
    cur = rec[key]
  }
  return cur
}

export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
