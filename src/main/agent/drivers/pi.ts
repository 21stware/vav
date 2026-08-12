import {
  asArray,
  asRecord,
  asString,
  dig,
  num,
  onJsonLines,
  spawnStdioProcess,
  type StdioProcess
} from './process'
import type { DriverControl, DriverEventSink, DriverStartOptions } from './types'

/**
 * Pi RPC mode: `pi --mode rpc --approve`
 * NDJSON request/response with string ids; unsolicited events on the same stream.
 */
export async function startPiDriver(
  options: DriverStartOptions,
  emit: DriverEventSink
): Promise<DriverControl> {
  // Pi only supports full-access via --approve (no interactive permission stream).
  const proc = spawnStdioProcess(
    options.binary,
    ['--mode', 'rpc', '--approve'],
    options.cwd,
    { ...options.env, PI_SKIP_VERSION_CHECK: '1' }
  )
  return wirePi(proc, options, emit)
}

function wirePi(
  proc: StdioProcess,
  options: DriverStartOptions,
  emit: DriverEventSink
): DriverControl {
  let disposed = false
  let seq = 0
  let turnActive = false
  let sessionId: string | null =
    options.cursor?.provider === 'pi' ? options.cursor.sessionId : null
  let sessionFile: string | null =
    options.cursor?.provider === 'pi' ? (options.cursor.sessionFile ?? null) : null
  let ready = false
  /** Cumulative token counters from the previous get_session_stats call. */
  let prevTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  const pendingPrompts: string[] = []
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  const stderrChunks: string[] = []

  const request = (type: string, rest: Record<string, unknown> = {}): Promise<unknown> => {
    const id = `vav-${++seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`pi RPC timeout: ${type}`))
      }, 15_000)
      pending.set(id, { resolve, reject, timer })
      proc.writeLine({ type, id, ...rest })
    })
  }

  proc.child.stderr.on('data', (buf: Buffer) => {
    stderrChunks.push(buf.toString('utf8'))
    if (stderrChunks.length > 40) stderrChunks.shift()
  })

  onJsonLines(proc.child.stdout, (value) => {
    const msg = asRecord(value)
    if (!msg) return
    const type = asString(msg.type)

    if (type === 'response') {
      const id = asString(msg.id)
      if (!id) return
      const waiter = pending.get(id)
      if (!waiter) return
      clearTimeout(waiter.timer)
      pending.delete(id)
      if (msg.success === false) {
        waiter.reject(new Error(asString(msg.error) || 'pi RPC failed'))
      } else {
        waiter.resolve(msg.data ?? msg)
      }
      return
    }

    // Events
    if (type === 'agent_start' || type === 'turn_start') {
      if (!turnActive) {
        turnActive = true
        emit({ type: 'turn-started' })
      }
      return
    }
    if (type === 'message_update') {
      const kind = asString(msg.kind) || asString(msg.updateType) || asString(dig(msg, 'delta.type'))
      const text =
        asString(msg.text) ||
        asString(msg.delta) ||
        asString(dig(msg, 'delta.text')) ||
        asString(dig(msg, 'delta.thinking')) ||
        ''
      if (!text) return
      if (kind?.includes('thinking') || kind === 'thinking_delta') {
        emit({ type: 'reasoning-delta', text })
      } else {
        emit({ type: 'text-delta', text })
      }
      return
    }
    if (type === 'tool_execution_start') {
      const id = asString(msg.toolCallId) || asString(msg.id) || `tool-${Date.now()}`
      emit({
        type: 'tool',
        id,
        name: asString(msg.toolName) || asString(msg.name) || 'tool',
        input: msg.args ?? msg.input ?? {},
        status: 'started'
      })
      return
    }
    if (type === 'tool_execution_update' || type === 'tool_execution_end') {
      const id = asString(msg.toolCallId) || asString(msg.id) || ''
      if (!id) return
      const isError = msg.isError === true || msg.success === false
      emit({
        type: 'tool',
        id,
        name: asString(msg.toolName) || 'tool',
        input: msg.args ?? {},
        status:
          type === 'tool_execution_end' ? (isError ? 'error' : 'completed') : 'updated',
        output:
          asString(msg.output) ||
          asString(msg.result) ||
          asString(dig(msg, 'details.display')) ||
          undefined
      })
      return
    }
    if (type === 'agent_settled') {
      turnActive = false
      const success = msg.success !== false
      void (async () => {
        try {
          const stats = asRecord(await request('get_session_stats'))
          if (stats) {
            const tokens = asRecord(stats.tokens) ?? {}
            const input = num(tokens.input) ?? 0
            const output = num(tokens.output) ?? 0
            const cacheRead = num(tokens.cacheRead) ?? 0
            const cacheWrite = num(tokens.cacheWrite) ?? 0
            const cost = num(stats.cost) ?? 0
            const contextUsage = asRecord(stats.contextUsage)
            const contextUsed = num(contextUsage?.tokens)
            const contextSize =
              num(contextUsage?.contextWindow) ??
              num(dig(stats, 'model.contextWindow'))
            const dIn = Math.max(0, input - prevTokens.input)
            const dOut = Math.max(0, output - prevTokens.output)
            const dRead = Math.max(0, cacheRead - prevTokens.cacheRead)
            const dWrite = Math.max(0, cacheWrite - prevTokens.cacheWrite)
            const dCost = Math.max(0, cost - prevTokens.cost)
            prevTokens = { input, output, cacheRead, cacheWrite, cost }
            emit({
              type: 'usage',
              inputTokens: dIn,
              outputTokens: dOut,
              cacheRead: dRead,
              cacheWrite: dWrite,
              contextUsed: contextUsed ?? (input + cacheRead > 0 ? input + cacheRead : undefined),
              contextSize: contextSize ?? undefined,
              sessionCostUsd: cost,
              turnCostUsd: dCost > 0 ? dCost : undefined,
              recordHistory: dIn > 0 || dOut > 0 || dRead > 0 || dWrite > 0
            })
          }
        } catch {
          /* stats optional */
        }
        emit({ type: 'turn-finished', success })
      })()
    }
  })

  proc.child.on('exit', (code) => {
    if (disposed) return
    if (turnActive) {
      emit({
        type: 'turn-finished',
        success: false,
        error: stderrChunks.join('').trim() || `pi exited (${code})`
      })
      turnActive = false
    }
    emit({ type: 'process-exited', code })
  })

  void (async () => {
    try {
      await request('get_state')
      if (sessionFile) {
        await request('switch_session', { sessionPath: sessionFile })
      }
      if (options.model) {
        const [provider, ...rest] = options.model.split('/')
        const modelId = rest.length ? rest.join('/') : options.model
        try {
          await request('set_model', {
            provider: rest.length ? provider : undefined,
            modelId
          })
        } catch {
          /* ignore */
        }
      }
      const state = asRecord(await request('get_state'))
      sessionId =
        asString(dig(state, 'sessionId')) ||
        asString(dig(state, 'data.sessionId')) ||
        sessionId
      sessionFile =
        asString(dig(state, 'sessionFile')) ||
        asString(dig(state, 'data.sessionFile')) ||
        sessionFile
      const contextSize = num(dig(state, 'model.contextWindow'))
      ready = true
      emit({
        type: 'connected',
        cursor: {
          provider: 'pi',
          sessionId: sessionId || 'unknown',
          sessionFile
        }
      })
      if (contextSize && contextSize > 0) {
        emit({ type: 'usage', contextSize, recordHistory: false })
      }
      for (const p of pendingPrompts.splice(0)) {
        turnActive = true
        emit({ type: 'turn-started' })
        proc.writeLine({ type: 'prompt', message: p })
      }
    } catch (err) {
      emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  })()

  return {
    prompt(text: string): void {
      if (!ready) {
        pendingPrompts.push(text)
        return
      }
      turnActive = true
      emit({ type: 'turn-started' })
      proc.writeLine({ type: 'prompt', message: text })
    },
    steer(text: string): void {
      proc.writeLine({ type: 'steer', message: text })
    },
    supportsSteer(): boolean {
      return true
    },
    cancel(): void {
      proc.writeLine({ type: 'abort' })
    },
    respond(): void {
      // --approve: no permission channel
    },
    applyOptions(opts): boolean {
      if (opts.approvalMode) return false
      if (opts.model) {
        const [provider, ...rest] = opts.model.split('/')
        const modelId = rest.length ? rest.join('/') : opts.model
        void request('set_model', {
          provider: rest.length ? provider : undefined,
          modelId
        }).catch(() => undefined)
        return true
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const w of pending.values()) {
        clearTimeout(w.timer)
        w.reject(new Error('disposed'))
      }
      pending.clear()
      proc.closeStdin()
      setTimeout(() => proc.kill(), 2_000)
    }
  }
}

void asArray
