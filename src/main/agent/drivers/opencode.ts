import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { loginPath } from '../../terminal/loginPath'
import { extractRpcErrorText } from '@shared/cliErrors'
import { asArray, asRecord, asString, dig, num } from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('no port'))
        return
      }
      const port = addr.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/**
 * OpenCode long-lived server: `opencode serve --hostname 127.0.0.1 --port N`
 * Protocol: HTTP + SSE `/event`
 */
export async function startOpenCodeDriver(
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: loginPath(),
    HOME: process.env.HOME || homedir(),
    ...options.env
  }
  const child = spawn(options.binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const base = `http://127.0.0.1:${port}`
  await waitForServer(base, child)

  let disposed = false
  let sessionId =
    options.cursor?.provider === 'opencode' ? options.cursor.sessionId : null
  let turnActive = false
  const autoApprove = options.approvalMode === 'bypass' || options.approvalMode === 'auto'
  const abortControllers = new Map<string, AbortController>()

  if (!sessionId) {
    const created = await jsonFetch(`${base}/session`, {
      method: 'POST',
      body: JSON.stringify({ title: 'VAV' })
    })
    sessionId = asString(dig(created, 'id')) || asString(dig(created, 'session.id'))
  }
  if (!sessionId) throw new Error('OpenCode session create failed')

  // Agent mode: build
  try {
    await jsonFetch(`${base}/session/${sessionId}/agent`, {
      method: 'POST',
      body: JSON.stringify({ agent: 'build' })
    })
  } catch {
    /* older servers may not have this route */
  }

  emit({ type: 'connected', cursor: { provider: 'opencode', sessionId } })

  // SSE
  const sseAbort = new AbortController()
  void (async () => {
    try {
      const res = await fetch(`${base}/event`, { signal: sseAbort.signal })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!disposed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const dataLine = chunk
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('')
          if (!dataLine) continue
          try {
            handleOpenCodeEvent(JSON.parse(dataLine), sessionId!, emit, {
              turnActive,
              setTurnActive: (v) => {
                turnActive = v
              },
              autoApprove,
              base,
              sessionId: sessionId!
            })
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* aborted / server down */
    }
  })()

  child.on('exit', (code) => {
    if (disposed) return
    if (turnActive) {
      emit({ type: 'turn-finished', success: false, error: `opencode exited (${code})` })
      turnActive = false
    }
    emit({ type: 'process-exited', code })
  })

  return {
    prompt(text: string): void {
      turnActive = true
      emit({ type: 'turn-started' })
      const body: Record<string, unknown> = {
        parts: [{ type: 'text', text }]
      }
      // OpenCode's HTTP API expects `model` as `{ providerID, modelID }`,
      // not a bare string. Model ids from `opencode models` are `provider/model`.
      if (options.model) {
        const slash = options.model.indexOf('/')
        if (slash > 0) {
          body.model = {
            providerID: options.model.slice(0, slash),
            modelID: options.model.slice(slash + 1)
          }
        }
        // No slash => unknown shape; omit and let OpenCode use its default.
      }
      void jsonFetch(`${base}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        body: JSON.stringify(body)
      }).catch((err) => {
        const message = extractRpcErrorText(err)
        emit({ type: 'error', message })
        turnActive = false
        emit({ type: 'turn-finished', success: false, error: message })
      })
    },
    steer(text: string): void {
      void jsonFetch(`${base}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text }] })
      })
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      void jsonFetch(`${base}/session/${sessionId}/abort`, { method: 'POST' })
    },
    respond(requestId: string, optionId: 'allow' | 'deny'): void {
      const reply = optionId === 'allow' ? 'once' : 'reject'
      void jsonFetch(`${base}/session/${sessionId}/permission/${requestId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply })
      })
    },
    applyOptions(opts): boolean {
      if (opts.approvalMode) return false
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      sseAbort.abort()
      for (const c of abortControllers.values()) c.abort()
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }
}

async function waitForServer(
  base: string,
  child: { exitCode: number | null }
): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastErr = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`opencode serve exited early (${child.exitCode}): ${lastErr}`)
    }
    try {
      const res = await fetch(`${base}/session`, { method: 'GET' })
      if (res.ok || res.status === 404 || res.status === 405) return
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await sleep(150)
  }
  throw new Error(`opencode serve did not become ready: ${lastErr}`)
}

async function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  if (res.status === 204) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function handleOpenCodeEvent(
  raw: unknown,
  sessionId: string,
  emit: DriverEventSink,
  ctx: {
    turnActive: boolean
    setTurnActive(v: boolean): void
    autoApprove: boolean
    base: string
    sessionId: string
  }
): void {
  const ev = asRecord(raw)
  if (!ev) return
  const type = asString(ev.type) || asString(ev.event) || ''
  const props = asRecord(ev.properties) ?? asRecord(ev.data) ?? ev
  const sid = asString(props.sessionID) || asString(props.sessionId)
  if (sid && sid !== sessionId) return

  if (type === 'message.part.delta') {
    const field = asString(props.field) || asString(props.key)
    const delta = asString(props.delta) || asString(props.text) || ''
    if (!delta) return
    if (field === 'reasoning' || field === 'thinking') emit({ type: 'reasoning-delta', text: delta })
    else emit({ type: 'text-delta', text: delta })
    return
  }

  if (type === 'message.part.updated') {
    const part = asRecord(props.part) ?? props
    const partType = asString(part.type)
    if (partType === 'tool') {
      const id = asString(part.id) || asString(part.callID) || `tool-${Date.now()}`
      const name = asString(part.tool) || asString(dig(part, 'state.tool')) || 'tool'
      const statusRaw = asString(dig(part, 'state.status')) || ''
      let status: 'started' | 'completed' | 'error' | 'updated' = 'updated'
      if (statusRaw === 'pending' || statusRaw === 'running') status = 'started'
      else if (statusRaw === 'completed' || statusRaw === 'success') status = 'completed'
      else if (statusRaw === 'error' || statusRaw === 'failed') status = 'error'
      emit({
        type: 'tool',
        id,
        name,
        input: dig(part, 'state.input') ?? {},
        status,
        output: asString(dig(part, 'state.output')) ?? undefined
      })
    }
    return
  }

  if (type === 'session.idle') {
    ctx.setTurnActive(false)
    // Pull real tokens/cost from the session API before finishing the turn.
    void emitOpenCodeUsage(ctx.base, ctx.sessionId, emit).finally(() => {
      emit({ type: 'turn-finished', success: true })
    })
    return
  }

  if (type === 'session.error') {
    ctx.setTurnActive(false)
    emit({
      type: 'turn-finished',
      success: false,
      error: extractRpcErrorText(props) || asString(props.message) || 'OpenCode session error'
    })
    return
  }

  if (type.startsWith('permission')) {
    const requestId = asString(props.id) || asString(props.requestID) || ''
    if (!requestId) return
    if (ctx.autoApprove) {
      void jsonFetch(`${ctx.base}/session/${ctx.sessionId}/permission/${requestId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply: 'always' })
      })
      return
    }
    emit({
      type: 'permission',
      requestId,
      toolName: asString(props.permission) || asString(props.type) || 'tool',
      summary: asString(props.pattern) || asString(props.title) || 'Permission required',
      input: props
    })
  }

  void asArray
}

async function emitOpenCodeUsage(
  base: string,
  sessionId: string,
  emit: DriverEventSink
): Promise<void> {
  try {
    const session = asRecord(await jsonFetch(`${base}/session/${sessionId}`))
    const sessionTokens =
      asRecord(session?.tokens) ?? asRecord(dig(session, 'data.tokens'))
    const sessionCost =
      num(session?.cost) ?? num(dig(session, 'data.cost')) ?? undefined

    // Prefer the latest assistant message for per-turn breakdown + context fill.
    let lastTokens: Record<string, unknown> | null = null
    let lastCost: number | undefined
    try {
      const listed = await jsonFetch(`${base}/session/${sessionId}/message`)
      const rows =
        asArray(listed) ??
        asArray(dig(listed, 'data')) ??
        asArray(dig(listed, 'messages')) ??
        []
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = asRecord(rows[i])
        if (!row) continue
        const info = asRecord(row.info) ?? row
        const role = asString(info.role) || asString(info.type) || asString(row.role)
        if (role && !/assistant/i.test(role)) continue
        const tokens = asRecord(info.tokens) ?? asRecord(row.tokens)
        if (!tokens) continue
        lastTokens = tokens
        lastCost = num(info.cost) ?? num(row.cost) ?? undefined
        break
      }
    } catch {
      /* older servers */
    }

    const tokens = lastTokens ?? sessionTokens
    if (!tokens && sessionCost == null) return
    const input = num(tokens?.input) ?? 0
    const output = num(tokens?.output) ?? 0
    const cacheRead = num(dig(tokens, 'cache.read')) ?? num(tokens?.cache_read) ?? 0
    const cacheWrite = num(dig(tokens, 'cache.write')) ?? num(tokens?.cache_write) ?? 0
    const contextUsed = input + cacheRead
    const record =
      !!lastTokens && (input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0)
    emit({
      type: 'usage',
      inputTokens: lastTokens ? input : undefined,
      outputTokens: lastTokens ? output : undefined,
      cacheRead: lastTokens ? cacheRead : undefined,
      cacheWrite: lastTokens ? cacheWrite : undefined,
      contextUsed: contextUsed > 0 ? contextUsed : undefined,
      sessionCostUsd: sessionCost ?? lastCost,
      turnCostUsd: record && lastCost != null ? lastCost : undefined,
      // Session-level totals alone must not be recorded as a turn sample.
      recordHistory: record
    })
  } catch {
    /* ignore — leave panel empty rather than invent numbers */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
