import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { RpcErrorCode } from '../../../shared/cliErrors.ts'
import { AcpRpcError } from './acpFs.ts'

const DEFAULT_OUTPUT_LIMIT = 1_048_576

export type AcpTerminalExit = {
  exitCode: number | null
  signal: string | null
}

export type AcpTerminalSnapshot = {
  output: string
  truncated: boolean
  exitStatus?: AcpTerminalExit
}

type LiveTerminal = {
  id: string
  child: ChildProcess
  chunks: Buffer[]
  bytes: number
  truncated: boolean
  limit: number
  exit: AcpTerminalExit | null
  waiters: Array<(exit: AcpTerminalExit) => void>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function decodeEnv(raw: unknown): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH,
    TERM: 'dumb',
    NO_COLOR: '1'
  }
  delete env.FORCE_COLOR
  const list = Array.isArray(raw) ? raw : []
  for (const item of list) {
    const rec = asRecord(item)
    const name = typeof rec?.name === 'string' ? rec.name : null
    if (!name) continue
    env[name] = typeof rec?.value === 'string' ? rec.value : ''
  }
  return env
}

function retainTail(buffer: Buffer, limit: number): { data: Buffer; truncated: boolean } {
  if (buffer.length <= limit) return { data: buffer, truncated: false }
  let start = buffer.length - limit
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1
  return { data: buffer.subarray(start), truncated: true }
}

export class AcpTerminalRegistry {
  private terminals = new Map<string, LiveTerminal>()

  create(params: Record<string, unknown>, fallbackCwd: string): { terminalId: string } {
    const command = typeof params.command === 'string' ? params.command : ''
    if (!command) throw new AcpRpcError(RpcErrorCode.invalidParams, 'command is required')
    const args = Array.isArray(params.args)
      ? params.args.filter((part): part is string => typeof part === 'string')
      : []
    const cwd =
      typeof params.cwd === 'string' && isAbsolute(params.cwd) ? params.cwd : fallbackCwd
    const limit =
      typeof params.outputByteLimit === 'number' && params.outputByteLimit > 0
        ? Math.floor(params.outputByteLimit)
        : DEFAULT_OUTPUT_LIMIT
    const id = `term_${randomUUID()}`
    const child = spawn(command, args, {
      cwd,
      env: decodeEnv(params.env),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const live: LiveTerminal = {
      id,
      child,
      chunks: [],
      bytes: 0,
      truncated: false,
      limit,
      exit: null,
      waiters: []
    }
    const onData = (buf: Buffer): void => {
      live.chunks.push(buf)
      live.bytes += buf.length
      if (live.bytes > live.limit) {
        const kept = retainTail(Buffer.concat(live.chunks), live.limit)
        live.chunks = [kept.data]
        live.bytes = kept.data.length
        live.truncated = true
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => {
      this.finish(live, { exitCode: 127, signal: null })
    })
    child.on('close', (code, signal) => {
      this.finish(live, { exitCode: code, signal: signal ?? null })
    })
    this.terminals.set(id, live)
    return { terminalId: id }
  }

  output(terminalId: string): AcpTerminalSnapshot {
    const live = this.require(terminalId)
    const snapshot: AcpTerminalSnapshot = {
      output: Buffer.concat(live.chunks).toString('utf8'),
      truncated: live.truncated
    }
    if (live.exit) snapshot.exitStatus = live.exit
    return snapshot
  }

  waitForExit(terminalId: string): Promise<AcpTerminalExit> {
    const live = this.require(terminalId)
    if (live.exit) return Promise.resolve(live.exit)
    return new Promise((resolve) => {
      live.waiters.push(resolve)
    })
  }

  kill(terminalId: string): Record<string, never> {
    const live = this.require(terminalId)
    if (!live.exit) {
      try {
        live.child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    return {}
  }

  release(terminalId: string): Record<string, never> {
    const live = this.terminals.get(terminalId)
    if (!live) return {}
    if (!live.exit) {
      try {
        live.child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    this.terminals.delete(terminalId)
    return {}
  }

  disposeAll(): void {
    for (const id of [...this.terminals.keys()]) this.release(id)
  }

  private require(terminalId: string): LiveTerminal {
    const live = this.terminals.get(terminalId)
    if (!live) {
      throw new AcpRpcError(RpcErrorCode.resourceNotFound, `Unknown terminal ${terminalId}`)
    }
    return live
  }

  private finish(live: LiveTerminal, exit: AcpTerminalExit): void {
    if (live.exit) return
    live.exit = exit
    const waiters = live.waiters.splice(0)
    for (const waiter of waiters) waiter(exit)
  }
}
