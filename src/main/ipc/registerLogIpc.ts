import type { IpcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import {
  isLogChannel,
  isLogRetentionClass,
  parseLogRecord,
  type AppLogClearScope,
  type AppLogInput,
  type AppLogQuery,
  type AppLogRecord,
  type AppLogStats
} from '@shared/appLog'
import type { LogStore } from '../store/LogStore'

export type LogIpcRemote = {
  query: (query?: AppLogQuery) => Promise<AppLogRecord[]>
  stats: () => Promise<AppLogStats>
  clear: (scope: AppLogClearScope) => Promise<number>
  exportText: (query?: AppLogQuery) => Promise<string>
  record: (input: AppLogInput) => Promise<void>
}

export type LogIpcHost = {
  saveExportPath: () => Promise<string | null>
  broadcast: (record: AppLogRecord) => void
  /** Local-shell vavd. Settings → Logs reads this sink when present. */
  remote?: () => LogIpcRemote | null
}

type DaemonLogClient = {
  connected: boolean
  request: (method: string, params?: unknown) => Promise<unknown>
  onStream: (id: string, handler: (event: string, data: unknown) => void) => void
  offStream: (id: string) => void
}

export function createDaemonLogRemote(client: DaemonLogClient): LogIpcRemote | null {
  if (!client.connected) return null
  return {
    async query(query) {
      const result = (await client.request('logs.query', query)) as { records?: unknown }
      if (!Array.isArray(result?.records)) return []
      return result.records
        .map((row) => parseLogRecord(row))
        .filter((row): row is AppLogRecord => row !== null)
    },
    async stats() {
      const result = (await client.request('logs.stats')) as Partial<AppLogStats> | undefined
      return {
        ephemeral: Number(result?.ephemeral) || 0,
        session: Number(result?.session) || 0,
        durable: Number(result?.durable) || 0,
        total: Number(result?.total) || 0
      }
    },
    async clear(scope) {
      const result = (await client.request('logs.clear', { scope })) as { removed?: unknown }
      return Number(result?.removed) || 0
    },
    async exportText(query) {
      const result = (await client.request('logs.export', query)) as { text?: unknown }
      return typeof result?.text === 'string' ? result.text : ''
    },
    async record(input) {
      await client.request('logs.record', input)
    }
  }
}

export function attachDaemonLogStream(
  client: DaemonLogClient,
  broadcast: (record: AppLogRecord) => void
): () => void {
  let streamId: string | null = null
  let stopped = false
  void client
    .request('logs.subscribe')
    .then((result) => {
      if (stopped) return
      const stream =
        result && typeof result === 'object' && typeof (result as { stream?: unknown }).stream === 'string'
          ? (result as { stream: string }).stream
          : ''
      if (!stream) return
      streamId = stream
      client.onStream(stream, (event, data) => {
        if (event !== 'append') return
        const record = parseLogRecord(data)
        if (record) broadcast(record)
      })
    })
    .catch(() => undefined)
  return () => {
    stopped = true
    if (!streamId) return
    client.offStream(streamId)
    void client.request('logs.unsubscribe', { stream: streamId }).catch(() => undefined)
  }
}

export function registerLogIpc(ipcMain: IpcMain, store: LogStore, host: LogIpcHost): void {
  store.onAppend = (record) => host.broadcast(record)

  ipcMain.handle(IPC.logsQuery, async (_event, query?: AppLogQuery) => {
    const next = sanitizeQuery(query)
    return viaRemote(
      host.remote?.(),
      () => store.query(next),
      (remote) => remote.query(next)
    )
  })

  ipcMain.handle(IPC.logsStats, async () =>
    viaRemote(host.remote?.(), () => store.stats(), (remote) => remote.stats())
  )

  ipcMain.handle(IPC.logsClear, async (_event, scope?: AppLogClearScope) => {
    const next =
      scope === 'all' || isLogRetentionClass(scope) ? scope : ('all' as AppLogClearScope)
    const removed = await viaRemote(
      host.remote?.(),
      () => store.clear(next),
      (remote) => remote.clear(next)
    )
    return { removed }
  })

  ipcMain.handle(IPC.logsExport, async (_event, query?: AppLogQuery) => {
    const path = await host.saveExportPath()
    if (!path) return { ok: false as const, cancelled: true }
    const next = sanitizeQuery(query)
    try {
      const text = await viaRemote(
        host.remote?.(),
        () => store.exportText(next),
        (remote) => remote.exportText(next)
      )
      writeFileSync(path, text, 'utf8')
      return { ok: true as const, path }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(IPC.logsRecord, async (_event, input: AppLogInput) => {
    if (!input || input.channel !== 'user') return
    const row: AppLogInput = {
      channel: 'user',
      event: String(input.event ?? ''),
      message: String(input.message ?? ''),
      conversationId: input.conversationId,
      data: input.data,
      level: input.level === 'debug' ? 'debug' : 'info'
    }
    await viaRemote(
      host.remote?.(),
      () => {
        store.append(row)
      },
      (remote) => remote.record(row)
    )
  })
}

async function viaRemote<T>(
  remote: LogIpcRemote | null | undefined,
  fallback: () => T,
  run: (remote: LogIpcRemote) => Promise<T>
): Promise<T> {
  if (!remote) return fallback()
  try {
    return await run(remote)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/unknown method|not connected/i.test(message)) return fallback()
    throw err
  }
}

function sanitizeQuery(query?: AppLogQuery): AppLogQuery {
  if (!query || typeof query !== 'object') return {}
  const channel =
    query.channel === 'all' || isLogChannel(query.channel) ? query.channel : undefined
  const retention =
    query.retention === 'all' || isLogRetentionClass(query.retention) ? query.retention : undefined
  return {
    channel,
    retention,
    conversationId: typeof query.conversationId === 'string' ? query.conversationId : undefined,
    search: typeof query.search === 'string' ? query.search : undefined,
    since: typeof query.since === 'number' ? query.since : undefined,
    until: typeof query.until === 'number' ? query.until : undefined,
    limit: typeof query.limit === 'number' ? query.limit : undefined
  }
}
