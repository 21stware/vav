import { basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { isTimerDefinition } from '../../shared/sessionKind.ts'
import {
  formatAppResourceUrl,
  isAppCatalogUrl,
  parseAppResourceUrl,
  type AppResourceKind
} from '../../shared/appResourceUrl.ts'
import {
  dataFileFormat,
  dataFileTitle,
  isDataFilePath
} from '../../shared/dataFile.ts'
import {
  dbConnectionTitle,
  parseDbUrl,
  type DbConnection
} from '../../shared/dbConnection.ts'
import {
  formatTimerSchedule,
  parseTimerScheduleInput,
  timerJobAgentFromConversation,
  type TimerJob
} from '../../shared/timer.ts'
import type { ConversationStore } from '../store/ConversationStore.ts'
import type { FileSessionStore } from '../store/FileSessionStore.ts'
import type { KnowledgeStore } from '../store/KnowledgeStore.ts'
import type { TimerStore } from '../store/TimerStore.ts'
import type { DbConnectionStore } from '../store/DbConnectionStore.ts'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService.ts'
import type { AppResourceHost, AppResourceMutation, AppResourceRow } from './toolsApp.ts'

export type AppConversationKind = 'db' | 'knowledge' | 'timer'

export function createAppResourceHost(deps: {
  conversations: ConversationStore
  fileSessions?: FileSessionStore
  knowledge?: KnowledgeStore
  files: {
    readTextWindow: (
      path: string,
      opts?: { conversationId?: string }
    ) => Promise<{ content: string; error?: string | null }>
    writeTextFile: (
      path: string,
      content: string,
      conversationId?: string
    ) => Promise<{ ok: boolean; error?: string }>
  }
  retrieval?: DocumentRetrievalService
  conversationId?: string
  timers?: Pick<
    TimerStore,
    'getJob' | 'getJobForConversation' | 'createJob' | 'updateJob' | 'removeJob'
  >
  dbConnections?: Pick<
    DbConnectionStore,
    'get' | 'getForConversation' | 'create' | 'update'
  >
  createAppConversation?: (kind: AppConversationKind) => { id: string; title: string }
  grantPath?: (path: string) => void
  onChanged?: (kind: AppResourceKind) => void
  onApply?: (event: import('../../shared/appHost.ts').AppHostEvent) => void
}): AppResourceHost {
  const list = (kind?: AppResourceKind): AppResourceRow[] => {
    const rows: AppResourceRow[] = []
    if (!kind || kind === 'storage') {
      for (const row of deps.fileSessions?.listAll() ?? []) {
        if (!row.isActive) continue
        rows.push({
          url: formatAppResourceUrl({ kind: 'storage', path: row.path, id: row.sessionId }),
          kind: 'storage',
          title: row.title || basename(row.path),
          id: row.sessionId,
          path: row.path,
          updatedAt: row.updatedAt
        })
      }
    }
    if (!kind || kind === 'data') {
      for (const row of deps.conversations.listClientMeta()) {
        if (row.archived || row.sessionKind !== 'db') continue
        rows.push({
          url: formatAppResourceUrl({
            kind: 'data',
            id: row.id,
            ...(row.dataFilePath ? { path: row.dataFilePath } : {})
          }),
          kind: 'data',
          title: row.title,
          id: row.id,
          path: row.dataFilePath,
          updatedAt: row.updatedAt
        })
      }
    }
    if (!kind || kind === 'knowledge') {
      for (const host of deps.knowledge?.list() ?? []) {
        const folder = host.folderId ? deps.knowledge?.getFolder(host.folderId)?.name : null
        rows.push({
          url: formatAppResourceUrl({
            kind: 'knowledge',
            id: host.id,
            ...(host.storedPath ? { path: host.storedPath } : {})
          }),
          kind: 'knowledge',
          title: host.title,
          id: host.id,
          path: host.storedPath,
          folder,
          updatedAt: host.updatedAt
        })
      }
    }
    if (!kind || kind === 'scheduled') {
      for (const row of deps.conversations.listClientMeta()) {
        if (row.archived || !isTimerDefinition(row)) continue
        rows.push({
          url: formatAppResourceUrl({ kind: 'scheduled', id: row.id }),
          kind: 'scheduled',
          title: row.title,
          id: row.id,
          updatedAt: row.updatedAt
        })
      }
    }
    return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  const resolve = (raw: string): AppResourceRow | null => {
    if (isAppCatalogUrl(raw)) return null
    const ref = parseAppResourceUrl(raw)
    if (!ref) return null
    const rows = list(ref.kind)
    if (ref.id) {
      const hit = rows.find((row) => row.id === ref.id)
      if (hit) return hit
    }
    if (ref.path) {
      const hit = rows.find((row) => row.path === ref.path)
      if (hit) return { ...hit, path: ref.path }
      return {
        url: raw,
        kind: ref.kind,
        title: basename(ref.path),
        path: ref.path,
        id: ref.id
      }
    }
    return null
  }

  const changed = (kind: AppResourceKind): void => {
    deps.onChanged?.(kind)
  }

  const applyOpen = (
    kind: AppResourceKind,
    result: { url: string; title: string } | { error: string }
  ): typeof result => {
    if ('url' in result && result.url) {
      deps.onApply?.({ type: 'open', url: result.url, kind })
    }
    return result
  }

  const conversationWorkdir = (): string | null => {
    if (!deps.conversationId) return null
    return deps.conversations.get(deps.conversationId)?.workingDirectory ?? null
  }

  const resolveStoragePath = (raw: string): string => {
    const path = raw.trim()
    if (!path) return path
    if (isAbsolute(path)) return path
    const workdir = conversationWorkdir()?.trim()
    return workdir ? resolvePath(workdir, path) : resolvePath(path)
  }

  const writeStorageFile = async (
    raw: string,
    content: string,
    title?: string
  ): Promise<{ url: string; title: string } | { error: string }> => {
    const path = resolveStoragePath(raw)
    deps.grantPath?.(path)
    const written = await deps.files.writeTextFile(path, content, deps.conversationId)
    if (!written.ok) return { error: written.error ?? 'Could not write file' }
    return {
      url: formatAppResourceUrl({ kind: 'storage', path }),
      title: title?.trim() || basename(path)
    }
  }

  const knowledgeUrl = (id: string, path?: string | null, title?: string) => ({
    url: formatAppResourceUrl({
      kind: 'knowledge',
      id,
      ...(path ? { path } : {})
    }),
    title: title ?? id
  })

  const createKnowledge = (input: AppResourceMutation) => {
    if (!deps.knowledge) return { error: 'Knowledge store is unavailable' }
    if (!deps.createAppConversation) return { error: 'Cannot create a Knowledge note (app catalog is unavailable)' }
    const content = input.content?.trim() ?? ''
    const heading =
      input.title?.trim() || content.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Untitled note'
    const conversation = deps.createAppConversation('knowledge')
    const requested = input.folderId?.trim() || ''
    const folderId =
      requested && requested !== 'all' && deps.knowledge.getFolder(requested) ? requested : null
    if (requested && requested !== 'all' && !folderId) {
      return { error: `Unknown folder ${requested}` }
    }
    const created = deps.knowledge.createNote(heading, conversation.id, Date.now(), folderId)
    const markdown = !content
      ? null
      : content.startsWith('#')
        ? content
        : `# ${heading}\n\n${content}`
    if (markdown) deps.knowledge.writeNote(created.id, markdown)
    const host = deps.knowledge.get(created.id) ?? created
    deps.conversations.updateMeta(conversation.id, {
      knowledgeHostId: host.id,
      sessionKind: 'knowledge',
      title: host.title
    })
    changed('knowledge')
    return knowledgeUrl(host.id, host.storedPath, host.title)
  }

  const writeKnowledge = (id: string, content: string) => {
    if (!deps.knowledge) return { error: 'Knowledge store is unavailable' }
    const note = deps.knowledge.writeNote(id, content)
    if (!note) return { error: `Cannot write knowledge ${id} (notes only)` }
    const host = deps.knowledge.get(id)
    if (host?.conversationId && host.title.trim()) {
      deps.conversations.updateMeta(host.conversationId, { title: host.title })
    }
    changed('knowledge')
    return knowledgeUrl(id, host?.storedPath, host?.title)
  }

  const jobForConversation = (conversationId: string): TimerJob | undefined => {
    const conv = deps.conversations.get(conversationId)
    if (conv?.timerJobId) {
      const byId = deps.timers?.getJob(conv.timerJobId)
      if (byId) return byId
    }
    return deps.timers?.getJobForConversation(conversationId)
  }

  const formatScheduled = (job: TimerJob, title: string): string => {
    const next = job.nextRunAt ? new Date(job.nextRunAt).toISOString() : '—'
    return [
      `Scheduled task: ${title}`,
      `Enabled: ${job.enabled ? 'yes' : 'no'}`,
      `Schedule: ${formatTimerSchedule(job.schedule)} (${job.schedule.kind})`,
      `Next run: ${next}`,
      `Workdir: ${job.workdirPolicy}`,
      '',
      'Prompt:',
      job.prompt || '(empty)'
    ].join('\n')
  }

  const createScheduled = (input: AppResourceMutation) => {
    if (!deps.timers) return { error: 'Timer store is unavailable' }
    if (!deps.createAppConversation) return { error: 'Cannot create a scheduled task (app catalog is unavailable)' }
    const schedule = input.schedule
      ? parseTimerScheduleInput(input.schedule)
      : { kind: 'cron' as const, expr: '0 9 * * *' }
    if (!schedule) return { error: 'Invalid schedule. Use a cron expr, `every 1h`, an ISO datetime, or JSON.' }
    const conversation = deps.createAppConversation('timer')
    const title = input.title?.trim() || conversation.title
    const job = deps.timers.createJob({
      title,
      prompt: input.prompt?.trim() || input.content?.trim() || '',
      schedule,
      enabled: input.enabled === true,
      conversationId: conversation.id,
      workdirPolicy: 'mint',
      sourceWorkdir: null,
      ...timerJobAgentFromConversation(deps.conversations.get(conversation.id) ?? conversation)
    })
    deps.conversations.updateMeta(conversation.id, {
      timerJobId: job.id,
      sessionKind: 'timer',
      title: job.title
    })
    changed('scheduled')
    return {
      url: formatAppResourceUrl({ kind: 'scheduled', id: conversation.id }),
      title: job.title
    }
  }

  const writeScheduled = (conversationId: string, content: string, extras?: AppResourceMutation) => {
    if (!deps.timers) return { error: 'Timer store is unavailable' }
    const job = jobForConversation(conversationId)
    if (!job) return { error: `Unknown scheduled task ${conversationId}` }
    const schedule = extras?.schedule ? parseTimerScheduleInput(extras.schedule) : undefined
    if (extras?.schedule && !schedule) {
      return { error: 'Invalid schedule. Use a cron expr, `every 1h`, an ISO datetime, or JSON.' }
    }
    const prompt = extras?.prompt ?? (content.trim() ? content : undefined)
    try {
      const updated = deps.timers.updateJob(job.id, {
        title: extras?.title,
        prompt,
        schedule: schedule ?? undefined,
        enabled: extras?.enabled
      })
      if (!updated) return { error: `Could not update scheduled task ${conversationId}` }
      if (updated.title) {
        deps.conversations.updateMeta(conversationId, { title: updated.title })
      }
      changed('scheduled')
      return {
        url: formatAppResourceUrl({ kind: 'scheduled', id: conversationId }),
        title: updated.title
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not update scheduled task' }
    }
  }

  const connectionForData = (conversationId: string | undefined): DbConnection | undefined => {
    if (!conversationId || !deps.dbConnections) return undefined
    const conv = deps.conversations.get(conversationId)
    if (conv?.dbConnectionId) {
      const byId = deps.dbConnections.get(conv.dbConnectionId)
      if (byId) return byId
    }
    return deps.dbConnections.getForConversation(conversationId)
  }

  const formatData = (input: {
    title: string
    path?: string | null
    conversationId?: string
  }): string => {
    if (input.path) {
      const format = dataFileFormat(input.path) ?? 'file'
      return [
        `Data file ${input.path} (${format}).`,
        'Use sql_query on this path (or omit path when this dataset is focused).'
      ].join('\n')
    }
    const connection = connectionForData(input.conversationId)
    if (connection) {
      const display = dbConnectionTitle(connection) || input.title
      return [
        `Live ${connection.driver} database: ${display}.`,
        connection.host ? `Host: ${connection.host}` : null,
        connection.database ? `Database: ${connection.database}` : null,
        connection.url ? `URL: ${connection.url}` : null,
        'Use sql_query (omit path). Live SQL is read-only — do not invent write/DDL APIs.'
      ]
        .filter((line): line is string => !!line)
        .join('\n')
    }
    return `Live database ${input.title}. Use sql_query (omit path).`
  }

  const createData = async (input: AppResourceMutation) => {
    if (!deps.createAppConversation) return { error: 'Cannot create a Data object (app catalog is unavailable)' }
    const path = input.path?.trim()
    const connectionUrl = input.connectionUrl?.trim()
    if (path) {
      if (!isDataFilePath(path)) {
        return { error: 'Data path must be a CSV, TSV, SQLite, Parquet, or DuckDB file.' }
      }
      deps.grantPath?.(path)
      if (input.content != null && input.content !== '') {
        const written = await deps.files.writeTextFile(path, input.content, deps.conversationId)
        if (!written.ok) return { error: written.error ?? 'Could not write data file' }
      }
      const conversation = deps.createAppConversation('db')
      const title = input.title?.trim() || dataFileTitle(path)
      deps.conversations.updateMeta(conversation.id, {
        sessionKind: 'db',
        dataFilePath: path,
        title
      })
      changed('data')
      return {
        url: formatAppResourceUrl({ kind: 'data', id: conversation.id, path }),
        title
      }
    }
    if (!deps.dbConnections) return { error: 'Database connections are unavailable' }
    const parsed = connectionUrl ? parseDbUrl(connectionUrl) : null
    if (connectionUrl && !parsed) return { error: 'Could not parse connection_url' }
    const conversation = deps.createAppConversation('db')
    const connection = deps.dbConnections.create({
      title: input.title?.trim() || '',
      conversationId: conversation.id,
      ...(parsed
        ? {
            driver: parsed.driver,
            useUrl: true,
            url: connectionUrl,
            ...(parsed.password ? { password: parsed.password } : {})
          }
        : {})
    })
    const title =
      input.title?.trim() || dbConnectionTitle(connection) || conversation.title
    deps.conversations.updateMeta(conversation.id, {
      dbConnectionId: connection.id,
      sessionKind: 'db',
      title
    })
    changed('data')
    return {
      url: formatAppResourceUrl({ kind: 'data', id: conversation.id }),
      title
    }
  }

  const writeData = async (
    conversationId: string | undefined,
    path: string | null,
    content: string,
    extras?: AppResourceMutation
  ) => {
    const filePath = extras?.path?.trim() || path
    if (filePath && content) {
      if (!isDataFilePath(filePath)) {
        return { error: 'Data path must be a CSV, TSV, SQLite, Parquet, or DuckDB file.' }
      }
      deps.grantPath?.(filePath)
      const written = await deps.files.writeTextFile(filePath, content, deps.conversationId)
      if (!written.ok) return { error: written.error ?? 'Could not write data file' }
      if (conversationId) {
        const title = extras?.title?.trim() || dataFileTitle(filePath)
        deps.conversations.updateMeta(conversationId, { dataFilePath: filePath, title })
      }
      changed('data')
      return {
        url: formatAppResourceUrl({
          kind: 'data',
          ...(conversationId ? { id: conversationId } : {}),
          path: filePath
        }),
        title: extras?.title?.trim() || dataFileTitle(filePath)
      }
    }
    const connectionUrl = extras?.connectionUrl?.trim()
    if (connectionUrl && conversationId && deps.dbConnections) {
      const parsed = parseDbUrl(connectionUrl)
      if (!parsed) return { error: 'Could not parse connection_url' }
      const existing = connectionForData(conversationId)
      if (!existing) return { error: `No live connection for ${conversationId}` }
      const connection = deps.dbConnections.update(existing.id, {
        driver: parsed.driver,
        useUrl: true,
        url: connectionUrl,
        ...(parsed.password ? { password: parsed.password } : {}),
        ...(extras?.title ? { title: extras.title } : {})
      })
      if (!connection) return { error: 'Could not update connection' }
      const title = extras?.title?.trim() || dbConnectionTitle(connection)
      if (title) deps.conversations.updateMeta(conversationId, { title })
      changed('data')
      return {
        url: formatAppResourceUrl({ kind: 'data', id: conversationId }),
        title: title || conversationId
      }
    }
    if (extras?.title && conversationId) {
      deps.conversations.updateMeta(conversationId, { title: extras.title })
      changed('data')
      return {
        url: formatAppResourceUrl({
          kind: 'data',
          id: conversationId,
          ...(filePath ? { path: filePath } : {})
        }),
        title: extras.title
      }
    }
    return { error: 'write data needs file content, connection_url, or title' }
  }

  return {
    list,
    resolve,
    focusedUrl: () => {
      if (!deps.conversationId) return null
      return deps.conversations.get(deps.conversationId)?.appColumnFocus?.url?.trim() || null
    },
    async read(raw) {
      const row = resolve(raw)
      const ref = parseAppResourceUrl(raw)
      if (!row && !ref) return { error: `Unknown app resource ${raw}` }
      const kind = row?.kind ?? ref!.kind
      const path = row?.path ?? ref?.path ?? null
      const id = row?.id ?? ref?.id
      const url = row?.url ?? raw
      const title = row?.title ?? path ?? id ?? kind

      if (kind === 'knowledge' && id && deps.knowledge) {
        const note = deps.knowledge.readNote(id)
        if (note) return { text: note.markdown, title, url }
        const host = deps.knowledge.get(id)
        if (host?.storedPath) {
          const windowed = await deps.files.readTextWindow(host.storedPath, {
            conversationId: deps.conversationId
          })
          if (windowed.error) return { error: windowed.error }
          return { text: windowed.content, title, url }
        }
        return { error: `Knowledge ${id} has no readable body` }
      }

      if (kind === 'scheduled' && id) {
        const conv = deps.conversations.get(id)
        if (!conv) return { error: `Unknown scheduled task ${id}` }
        const job = jobForConversation(id)
        if (!job) return { text: `Scheduled task: ${conv.title}`, title, url }
        return { text: formatScheduled(job, conv.title), title, url }
      }

      if (kind === 'data') {
        return {
          text: formatData({ title, path, conversationId: id }),
          title,
          url
        }
      }

      if (!path) return { error: `No path for ${url}` }
      const windowed = await deps.files.readTextWindow(path, {
        conversationId: deps.conversationId
      })
      if (windowed.error) return { error: windowed.error }
      return { text: windowed.content, title, url }
    },
    async write(raw, content, extras) {
      const ref = parseAppResourceUrl(raw)
      const kind = ref?.kind
      if (ref && kind === 'knowledge') {
        if (ref.id) return writeKnowledge(ref.id, content)
        return createKnowledge({ ...extras, content })
      }
      if (ref && kind === 'scheduled') {
        if (ref.id) return writeScheduled(ref.id, content, extras)
        return createScheduled({ ...extras, content })
      }
      if (ref && kind === 'data') {
        if (ref.id || extras?.path || extras?.connectionUrl || ref.path) {
          if (!ref.id && !ref.path) return createData({ ...extras, content, path: extras?.path || ref.path })
          return writeData(ref.id, ref.path ?? resolve(raw)?.path ?? null, content, extras)
        }
        return createData({ ...extras, content })
      }
      const path = extras?.path || ref?.path || resolve(raw)?.path
      if (!path) return { error: 'write needs a storage path or an app resource url' }
      return writeStorageFile(path, content)
    },
    async create(input) {
      if (input.kind === 'knowledge') return applyOpen(input.kind, createKnowledge(input))
      if (input.kind === 'scheduled') return applyOpen(input.kind, createScheduled(input))
      if (input.kind === 'data') return applyOpen(input.kind, await createData(input))
      const path = input.path?.trim()
      if (!path) return { error: 'create storage needs path' }
      return applyOpen(input.kind, await writeStorageFile(path, input.content ?? '', input.title))
    },
    async remove(raw) {
      const ref = parseAppResourceUrl(raw)
      const row = resolve(raw)
      const id = ref?.id || row?.id
      const kind = ref?.kind || row?.kind
      if (kind === 'knowledge' && deps.knowledge) {
        const hostId = ref?.id || row?.id
        const host = hostId ? deps.knowledge.get(hostId) : undefined
        if (!hostId || !deps.knowledge.remove(hostId)) {
          return { error: `Could not remove knowledge ${hostId}` }
        }
        if (host?.conversationId) deps.conversations.setArchived(host.conversationId, true)
        changed('knowledge')
        return { ok: true as const, url: raw }
      }
      if (kind === 'scheduled' && id) {
        const job = jobForConversation(id)
        if (job) deps.timers?.removeJob(job.id)
        const archived = deps.conversations.setArchived(id, true)
        if (!archived) return { error: `Unknown scheduled task ${id}` }
        changed('scheduled')
        return { ok: true as const, url: raw }
      }
      if (id) {
        const archived = deps.conversations.setArchived(id, true)
        if (!archived) return { error: `Unknown app object ${id}` }
        if (kind) changed(kind)
        return { ok: true as const, url: raw }
      }
      return { error: 'delete needs a vav://app URL with id' }
    },
    async search(raw, query) {
      const ref = raw ? parseAppResourceUrl(raw) : null
      const path = ref?.path || (raw ? resolve(raw)?.path : null)
      if (path && deps.retrieval) {
        const result = await deps.retrieval.search({ path, query, topK: 8 })
        if (result.error) return { error: result.error }
        const lines = result.hits.map(
          (hit) => `- [${hit.chunk.id}] ${hit.chunk.label ?? hit.chunk.kind}: ${hit.chunk.text.slice(0, 400)}`
        )
        return {
          text:
            lines.join('\n') ||
            `No matching chunks in ${path}. Catalog hits:\n${formatRowsForSearch(list(ref?.kind), query)}`
        }
      }
      if ((ref?.kind === 'knowledge' || !ref) && deps.knowledge && deps.retrieval) {
        const targets = deps.knowledge
          .searchTargets()
          .filter((row) => !ref?.id || row.id === ref.id)
        const hits: string[] = []
        for (const target of targets) {
          const result = await deps.retrieval.search({ path: target.path, query, topK: 6 })
          if (result.error || !result.hits.length) continue
          hits.push(
            `# ${target.title} (${target.id})\n${formatAppResourceUrl({
              kind: 'knowledge',
              id: target.id,
              path: target.path
            })}\n` +
              result.hits
                .map((hit) => `- [${hit.chunk.id}] ${hit.chunk.text.slice(0, 280)}`)
                .join('\n')
          )
        }
        if (hits.length) return { text: hits.join('\n\n') }
      }
      return { text: formatRowsForSearch(list(ref?.kind), query) }
    }
  }
}

function formatRowsForSearch(rows: AppResourceRow[], query: string): string {
  const needle = query.toLowerCase()
  const matched = rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) ||
      (row.path ?? '').toLowerCase().includes(needle)
  )
  if (matched.length === 0) return 'No matching app resources.'
  return matched.map((row) => `- ${row.title}\n  ${row.url}`).join('\n')
}
