/**
 * Sign a CLI in over ACP: `initialize` → `authenticate { methodId }`.
 * The host owns the browser step (Droid opens the device-pairing page and
 * polls until it is approved), so this only drives JSON-RPC and waits.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export const ACP_LOGIN_TIMEOUT_MS = 10 * 60_000
const ACP_PROTOCOL_VERSION = 1

export type AcpLoginJob = {
  kill: () => void
  done: Promise<{ exitCode: number | null; message?: string }>
}

function rpcErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as { message?: unknown; data?: unknown }
  const data = record.data && typeof record.data === 'object' ? (record.data as { details?: unknown }) : null
  if (typeof data?.details === 'string' && data.details.trim()) return data.details.trim()
  return typeof record.message === 'string' && record.message.trim() ? record.message.trim() : undefined
}

export function startAcpLogin(input: {
  file: string
  args: string[]
  methodId: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
}): AcpLoginJob {
  const child = spawn(input.file, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  })
  let settled = false
  let resolveDone!: (value: { exitCode: number | null; message?: string }) => void
  const done = new Promise<{ exitCode: number | null; message?: string }>((resolve) => {
    resolveDone = resolve
  })

  const stop = (): void => {
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }
    if (child.exitCode == null && child.signalCode == null) child.kill()
  }

  const finish = (exitCode: number | null, message?: string): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveDone({ exitCode, message })
    stop()
  }

  const timer = setTimeout(
    () => finish(1, 'ACP login timed out'),
    input.timeoutMs ?? ACP_LOGIN_TIMEOUT_MS
  )

  const send = (payload: Record<string, unknown>): void => {
    if (!child.stdin.writable) return
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`)
  }

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.method !== undefined) {
      // Agent→client requests are not expected during login; never leave one hanging.
      if (msg.id !== undefined) {
        send({ id: msg.id, error: { code: -32601, message: 'Method not found' } })
      }
      return
    }
    if (msg.id === 1) {
      if (msg.error) {
        finish(1, rpcErrorMessage(msg.error))
        return
      }
      send({ id: 2, method: 'authenticate', params: { methodId: input.methodId } })
      return
    }
    if (msg.id === 2) {
      if (msg.error) finish(1, rpcErrorMessage(msg.error))
      else finish(0)
    }
  })

  child.on('error', (err) => finish(1, err.message))
  // Exiting before `authenticate` answers is a failed login even on code 0.
  child.on('exit', (code) => finish(code ? code : 1, 'ACP host exited before login finished'))

  send({
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'vav', version: '1.0.0' }
    }
  })

  return {
    kill: () => finish(null),
    done
  }
}
