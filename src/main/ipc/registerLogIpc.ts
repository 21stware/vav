import type { IpcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import {
  isLogChannel,
  isLogRetentionClass,
  type AppLogClearScope,
  type AppLogInput,
  type AppLogQuery,
  type AppLogRecord
} from '@shared/appLog'
import type { LogStore } from '../store/LogStore'

export type LogIpcHost = {
  saveExportPath: () => Promise<string | null>
  broadcast: (record: AppLogRecord) => void
}

export function registerLogIpc(ipcMain: IpcMain, store: LogStore, host: LogIpcHost): void {
  store.onAppend = (record) => host.broadcast(record)

  ipcMain.handle(IPC.logsQuery, (_event, query?: AppLogQuery) => store.query(sanitizeQuery(query)))

  ipcMain.handle(IPC.logsStats, () => store.stats())

  ipcMain.handle(IPC.logsClear, (_event, scope?: AppLogClearScope) => {
    const next =
      scope === 'all' || isLogRetentionClass(scope) ? scope : ('all' as AppLogClearScope)
    return { removed: store.clear(next) }
  })

  ipcMain.handle(IPC.logsExport, async (_event, query?: AppLogQuery) => {
    const path = await host.saveExportPath()
    if (!path) return { ok: false as const, cancelled: true }
    try {
      writeFileSync(path, store.exportText(sanitizeQuery(query)), 'utf8')
      return { ok: true as const, path }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(IPC.logsRecord, (_event, input: AppLogInput) => {
    if (!input || input.channel !== 'user') return
    store.append({
      channel: 'user',
      event: String(input.event ?? ''),
      message: String(input.message ?? ''),
      conversationId: input.conversationId,
      data: input.data,
      level: input.level === 'debug' ? 'debug' : 'info'
    })
  })
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
