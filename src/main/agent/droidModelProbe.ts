import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, rmdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelOption } from '../../shared/types.ts'
import { parseAcpAvailableModels } from './drivers/acpModelId.ts'

const PROBE_DIR_PREFIX = 'vav-droid-models-'
const EXIT_GRACE_MS = 2_000

/**
 * Droid has no `--list-models`; its catalogue is only advertised on ACP
 * `session/new`. Rows keep the exact ACP ids because `session/set_model`
 * rejects anything else.
 */
export function droidModelsFromSession(result: unknown): ModelOption[] {
  const record =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null
  const listed = parseAcpAvailableModels(record?.models)
  const out: ModelOption[] = []
  const seen = new Set<string>()
  for (const row of listed) {
    if (seen.has(row.modelId)) continue
    seen.add(row.modelId)
    out.push({ id: row.modelId, label: row.name?.trim() || row.modelId })
  }
  return out
}

export interface DroidModelProbeOptions {
  env?: Record<string, string>
  timeoutMs: number
  /** Droid session store root (default `~/.factory/sessions`). */
  sessionsRoot?: string
}

/**
 * Opens a throwaway ACP session in a private temp cwd, reads the advertised
 * models, then deletes that session from Droid's history so probes never
 * show up in `droid --resume`.
 */
export async function probeDroidAcpModels(
  binary: string,
  options: DroidModelProbeOptions
): Promise<ModelOption[]> {
  const cwd = await mkdtemp(join(tmpdir(), PROBE_DIR_PREFIX))
  let sessionId: string | null = null
  try {
    const result = await runAcpSessionNew(binary, cwd, options)
    sessionId = result.sessionId
    return droidModelsFromSession(result.session)
  } finally {
    await removeProbeSession(options.sessionsRoot ?? defaultSessionsRoot(), sessionId)
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

function defaultSessionsRoot(): string {
  return join(homedir(), '.factory', 'sessions')
}

/** Only touches dirs minted for a probe cwd, and only that session's files. */
export async function removeProbeSession(root: string, sessionId: string | null): Promise<void> {
  if (!sessionId) return
  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return
  }
  for (const dir of dirs) {
    if (!dir.includes(PROBE_DIR_PREFIX)) continue
    const full = join(root, dir)
    let files: string[]
    try {
      files = await readdir(full)
    } catch {
      continue
    }
    for (const file of files) {
      if (file.startsWith(`${sessionId}.`)) {
        await rm(join(full, file), { force: true }).catch(() => undefined)
      }
    }
    await rmdir(full).catch(() => undefined)
  }
}

function runAcpSessionNew(
  binary: string,
  cwd: string,
  options: DroidModelProbeOptions
): Promise<{ sessionId: string | null; session: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['exec', '--output-format', 'acp'], {
      cwd,
      env: { ...process.env, ...(options.env ?? {}), CI: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let buffer = ''
    let stderr = ''
    let settled = false
    let outcome: { sessionId: string | null; session: unknown } | Error | null = null
    const exited = new Promise<void>((done) => child.once('close', () => done()))

    const finish = (value: { sessionId: string | null; session: unknown } | Error): void => {
      if (settled) return
      settled = true
      outcome = value
      clearTimeout(timer)
      child.stdin.end()
      child.kill('SIGTERM')
      // Session files are flushed on exit; wait so cleanup sees them.
      const force = setTimeout(() => child.kill('SIGKILL'), EXIT_GRACE_MS)
      void exited.then(() => {
        clearTimeout(force)
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome!)
      })
    }

    const timer = setTimeout(
      () => finish(new Error(`Timed out listing models (${binary} exec --output-format acp)`)),
      options.timeoutMs
    )

    const send = (id: number, method: string, params: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    }

    const onMessage = (message: Record<string, unknown>): void => {
      if (message.id === 1) {
        if (message.error) return finish(rpcError(message.error, 'initialize failed'))
        send(2, 'session/new', { cwd, mcpServers: [] })
        return
      }
      if (message.id === 2) {
        if (message.error) return finish(rpcError(message.error, 'session/new failed'))
        const session = message.result
        const record =
          session && typeof session === 'object' ? (session as Record<string, unknown>) : {}
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
        finish({ sessionId, session })
        return
      }
      // Agent → client requests (permissions, fs) are never expected before a
      // prompt; answer so the agent does not stall.
      if (message.id != null && typeof message.method === 'string') {
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported' } })}\n`
        )
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      buffer += String(chunk)
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            onMessage(parsed as Record<string, unknown>)
          }
        } catch {
          /* non-JSON log line */
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-2_000)
    })
    child.stdin.on('error', () => undefined)
    child.on('error', (err) => finish(err))
    child.on('close', (code) => {
      if (!settled) {
        finish(new Error(stderr.trim() || `droid exited before listing models (exit ${code ?? '?'})`))
      }
    })

    send(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })
  })
}

function rpcError(error: unknown, fallback: string): Error {
  const message =
    error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : fallback
  // Signed-out Droid embeds a one-time pairing code in this message.
  if (/authentication required/i.test(message)) return new Error('Droid is not signed in')
  return new Error(message)
}
