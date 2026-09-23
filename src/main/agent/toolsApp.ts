import {
  formatAppCatalogUrl,
  formatAppResourceUrl,
  isAppCatalogUrl,
  isAppResourceKind,
  parseAppResourceUrl,
  type AppResourceKind,
  type AppResourceRef
} from '../../shared/appResourceUrl.ts'
import { formatAppCatalogCapabilities } from '../../shared/appPlugins.ts'
import { TOOL_LABELS } from '../../shared/types.ts'
import { cap } from './toolSummarize.ts'
import { Type, defineTool, failure, type ToolHost } from './toolHost.ts'

export type AppResourceRow = {
  url: string
  kind: AppResourceKind
  title: string
  id?: string
  path?: string | null
  /** Knowledge folder name, when the note lives in one. */
  folder?: string | null
  updatedAt?: number
}

export type AppResourceMutation = {
  content?: string
  title?: string
  path?: string
  prompt?: string
  schedule?: string
  enabled?: boolean
  connectionUrl?: string
  /** Knowledge create: folder id. Omit to leave the note unfiled. */
  folderId?: string
}

export type AppResourceHost = {
  list(kind?: AppResourceKind): AppResourceRow[]
  resolve(raw: string): AppResourceRow | null
  read(raw: string): Promise<{ text: string; title: string; url: string } | { error: string }>
  write(
    raw: string,
    content: string,
    extras?: AppResourceMutation
  ): Promise<{ url: string; title: string } | { error: string }>
  create(
    input: AppResourceMutation & { kind: AppResourceKind }
  ): Promise<{ url: string; title: string } | { error: string }>
  remove(raw: string): Promise<{ ok: true; url: string } | { error: string }>
  search?(
    raw: string | null,
    query: string
  ): Promise<{ text: string } | { error: string }>
  /** Open app-column item for this conversation, when one is focused. */
  focusedUrl?(): string | null
}

const OPS = ['list', 'get', 'search', 'write', 'create', 'delete'] as const
type AppOp = (typeof OPS)[number]

function asOp(value: unknown): AppOp | null {
  const op = String(value ?? '').trim().toLowerCase()
  return (OPS as readonly string[]).includes(op) ? (op as AppOp) : null
}

function kindOf(value: unknown): AppResourceKind | undefined {
  const kind = String(value ?? '').trim()
  return isAppResourceKind(kind) ? kind : undefined
}

function formatRows(rows: AppResourceRow[]): string {
  if (rows.length === 0) return 'No matching app resources.'
  return rows
    .map((row) => {
      const path = row.path ? ` · ${row.path}` : ''
      const folder = row.folder ? ` · ${row.folder}` : ''
      return `- ${row.title} (${row.kind}${folder}${path})\n  ${row.url}`
    })
    .join('\n')
}

export function appOpFromArgs(name: string, args: unknown): string {
  if (name !== 'app' || !args || typeof args !== 'object' || !('op' in args)) return ''
  return String((args as { op: unknown }).op ?? '')
    .trim()
    .toLowerCase()
}

export function isAppMutatingOp(op: string): boolean {
  return op === 'write' || op === 'create' || op === 'delete'
}

function mutationFromParams(params: Record<string, unknown>): AppResourceMutation {
  const enabled = params.enabled
  return {
    content: params.content != null ? String(params.content) : undefined,
    title: optionalString(params.title),
    path: optionalString(params.path),
    prompt: optionalString(params.prompt),
    schedule: optionalString(params.schedule),
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
    connectionUrl: optionalString(params.connection_url),
    folderId: optionalString(params.folder_id)
  }
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text || undefined
}

export function createAppTools(host: ToolHost) {
  const app = defineTool({
    name: 'app',
    label: TOOL_LABELS.app,
    description:
      'List, read, search, and delete app-column items. Address them with `vav://app/…` URLs. ops: list, get, search, create, write, delete. Prefer the dedicated tools to create or edit: `note_write` / `note_edit`, `analysis_write` / `analysis_edit`, `schedule_write` / `schedule_edit`, `storage_write` / `storage_edit`. Do not fs_write those into the working directory.',
    parameters: Type.Object({
      op: Type.String({
        description: 'list | get | search | create | write | delete'
      }),
      url: Type.Optional(
        Type.String({
          description:
            'vav://app/storage|data|knowledge|scheduled[?id=…&path=…&dir=1]. Omit with list to show every kind. get/write omit to use the open app-column item. create may omit url and pass kind.'
        })
      ),
      kind: Type.Optional(
        Type.String({
          description: `${formatAppCatalogCapabilities()} (list / search / create).`
        })
      ),
      query: Type.Optional(Type.String({ description: 'search: keywords. list: optional title/path filter.' })),
      content: Type.Optional(
        Type.String({
          description:
            'write/create: note markdown, scheduled-task prompt, or storage/data-file text.'
        })
      ),
      title: Type.Optional(Type.String({ description: 'create/write: display title.' })),
      path: Type.Optional(
        Type.String({
          description: 'create data: CSV/TSV/SQLite/Parquet path. create storage: file path.'
        })
      ),
      prompt: Type.Optional(Type.String({ description: 'create/write scheduled: the task prompt.' })),
      schedule: Type.Optional(
        Type.String({
          description:
            'create/write scheduled: cron (`0 9 * * *`), `every 1h` / `every 30m`, ISO datetime, or JSON TimerSchedule.'
        })
      ),
      enabled: Type.Optional(
        Type.Boolean({ description: 'create/write scheduled: whether the job is armed. New jobs default off.' })
      ),
      connection_url: Type.Optional(
        Type.String({
          description: 'create/write data: live database URL (postgres/mysql/clickhouse/…).'
        })
      ),
      folder_id: Type.Optional(
        Type.String({
          description: 'create knowledge: folder id from knowledge_library. Omit for All Notes.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const op = asOp(params.op)
      if (!op) return failure('op must be list, get, search, create, write, or delete')
      const explicitUrl = String(params.url ?? '').trim()
      const focusedUrl =
        op === 'get' || op === 'write' ? host.appResources.focusedUrl?.()?.trim() || '' : ''
      const url = explicitUrl || focusedUrl
      const kind = kindOf(params.kind) ?? parseAppResourceUrl(url)?.kind
      const query = String(params.query ?? '').trim()
      const mutation = mutationFromParams(params as Record<string, unknown>)

      if (op === 'list') {
        const rows = filterRows(host.appResources.list(kind), query)
        const header = kind ? `App ${kind} (${rows.length})` : `App resources (${rows.length})`
        const catalog = !url && !kind ? `${formatAppCatalogUrl()}\n\n` : ''
        const text = `${catalog}${header}\n${formatRows(rows)}`
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }

      if (op === 'search') {
        if (!query) return failure('search needs query')
        if (host.appResources.search) {
          const found = await host.appResources.search(url || null, query)
          if ('error' in found) return failure(found.error)
          return {
            content: [{ type: 'text' as const, text: cap(found.text) }],
            details: { display: found.text }
          }
        }
        const rows = filterRows(host.appResources.list(kind), query)
        const text = formatRows(rows)
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }

      if (!url && op !== 'write' && op !== 'create') return failure(`${op} needs url=vav://app/…`)

      if (op === 'get') {
        const read = await host.appResources.read(url)
        if ('error' in read) return failure(read.error)
        const text = `${read.title}\n${read.url}\n\n${read.text}`
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }

      if (op === 'create') {
        if (!kind) return failure('create needs kind=storage|data|knowledge|scheduled')
        const created = await host.appResources.create({ ...mutation, kind })
        if ('error' in created) return failure(created.error)
        const text = `Created ${created.title}\n${created.url}`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }

      if (op === 'write') {
        const content = String(params.content ?? params.prompt ?? '')
        const target = url || (kind ? formatAppResourceUrl({ kind }) : '')
        if (!target) return failure('write needs url or kind')
        const written = await host.appResources.write(target, content, mutation)
        if ('error' in written) return failure(written.error)
        const text = `Updated ${written.title}\n${written.url}`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }

      const removed = await host.appResources.remove(url)
      if ('error' in removed) return failure(removed.error)
      const text = `Removed ${removed.url}`
      return { content: [{ type: 'text' as const, text }], details: { display: text } }
    }
  })

  const analysisWrite = defineTool({
    name: 'analysis_write',
    label: TOOL_LABELS.analysis_write,
    description:
      'Create an Analysis object in the app (分析 / Data). Pass `path` for a CSV/TSV/SQLite/Parquet/DuckDB file, or `connection_url` for a live database (postgres/mysql/clickhouse/…). Optional `content` writes CSV/TSV text at `path`. Then query with `sql_query`. This is not fs_write — do not drop a dataset into the working directory.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Display title.' })),
      path: Type.Optional(
        Type.String({ description: 'CSV, TSV, SQLite, Parquet, or DuckDB file to attach.' })
      ),
      connection_url: Type.Optional(
        Type.String({ description: 'Live database URL (postgres/mysql/clickhouse/…).' })
      ),
      content: Type.Optional(
        Type.String({ description: 'Full CSV/TSV text when creating a new data file at path.' })
      )
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const path = optionalString(params.path)
      const connectionUrl = optionalString(params.connection_url)
      if (!path && !connectionUrl) {
        return failure('Pass path (CSV/TSV/SQLite/Parquet) or connection_url. analysis_write does not create a workspace file.')
      }
      const created = await host.appResources.create({
        kind: 'data',
        title: optionalString(params.title),
        path,
        connectionUrl,
        content: params.content != null ? String(params.content) : undefined
      })
      if ('error' in created) return failure(created.error)
      return saved('Created', created)
    }
  })

  const analysisEdit = defineTool({
    name: 'analysis_edit',
    label: TOOL_LABELS.analysis_edit,
    description:
      'Update an existing Analysis object (分析 / Data). Omit `url` to edit the dataset open in the app column. Pass `content` to replace a CSV/TSV file, `connection_url` to retarget a live database, or `title` to rename. Then use `sql_query`. Not fs_write.',
    parameters: Type.Object({
      url: Type.Optional(
        Type.String({ description: 'vav://app/data?id=… URL. Omit to use the open Analysis.' })
      ),
      title: Type.Optional(Type.String({ description: 'Display title.' })),
      path: Type.Optional(Type.String({ description: 'Replacement CSV/TSV/SQLite/Parquet path.' })),
      connection_url: Type.Optional(Type.String({ description: 'Replacement live database URL.' })),
      content: Type.Optional(Type.String({ description: 'Full CSV/TSV text for the data file.' }))
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const url = openAppUrl(host, 'data', optionalString(params.url))
      if (!url) return failure('Pass url, or open an Analysis dataset in the app column.')
      const written = await host.appResources.write(url, String(params.content ?? ''), {
        title: optionalString(params.title),
        path: optionalString(params.path),
        connectionUrl: optionalString(params.connection_url)
      })
      if ('error' in written) return failure(written.error)
      return saved('Updated', written)
    }
  })

  const scheduleWrite = defineTool({
    name: 'schedule_write',
    label: TOOL_LABELS.schedule_write,
    description:
      'Create a Scheduled task in the app (日程). Pass `title`, optional `prompt` (what the run should do), and `schedule` (cron `0 9 * * *`, `every 1h` / `every 30m`, ISO datetime, or JSON). New tasks stay disabled unless `enabled` is true. An empty prompt does not block create or enable — the job simply does not fire until a prompt is set. This is not a file and not fs_write.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Task title.' })),
      prompt: Type.Optional(Type.String({ description: 'What the scheduled run should do. Empty jobs stay idle until a prompt is set.' })),
      schedule: Type.Optional(
        Type.String({
          description: 'cron (`0 9 * * *`), `every 1h` / `every 30m`, ISO datetime, or JSON TimerSchedule. Default 0 9 * * *.'
        })
      ),
      enabled: Type.Optional(
        Type.Boolean({ description: 'Arm the job. New tasks stay off unless this is true. Empty prompts do not block this.' })
      )
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const created = await host.appResources.create({
        kind: 'scheduled',
        title: optionalString(params.title),
        prompt: String(params.prompt ?? '').trim(),
        schedule: optionalString(params.schedule),
        enabled: typeof params.enabled === 'boolean' ? params.enabled : undefined
      })
      if ('error' in created) return failure(created.error)
      return saved('Created', created)
    }
  })

  const scheduleEdit = defineTool({
    name: 'schedule_edit',
    label: TOOL_LABELS.schedule_edit,
    description:
      'Update an existing Scheduled task (日程). Omit `url` to edit the task open in the app column. Pass any of `title`, `prompt`, `schedule`, `enabled`. Not a file.',
    parameters: Type.Object({
      url: Type.Optional(
        Type.String({ description: 'vav://app/scheduled?id=… URL. Omit to use the open task.' })
      ),
      title: Type.Optional(Type.String({ description: 'Task title.' })),
      prompt: Type.Optional(Type.String({ description: 'Replacement task prompt.' })),
      schedule: Type.Optional(Type.String({ description: 'Replacement schedule.' })),
      enabled: Type.Optional(Type.Boolean({ description: 'Whether the job is armed.' }))
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const url = openAppUrl(host, 'scheduled', optionalString(params.url))
      if (!url) return failure('Pass url, or open a scheduled task in the app column.')
      const written = await host.appResources.write(url, String(params.prompt ?? ''), {
        title: optionalString(params.title),
        prompt: optionalString(params.prompt),
        schedule: optionalString(params.schedule),
        enabled: typeof params.enabled === 'boolean' ? params.enabled : undefined
      })
      if ('error' in written) return failure(written.error)
      return saved('Updated', written)
    }
  })

  const storageWrite = defineTool({
    name: 'storage_write',
    label: TOOL_LABELS.storage_write,
    description:
      'Add a file to the app Storage catalog (存储). Pass `path` and full `content`. Use this when the user wants the file kept in Storage. Workspace source edits stay on fs_write. A Note is note_write; an Analysis dataset is analysis_write.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path to store.' }),
      content: Type.String({ description: 'Full file contents.' }),
      title: Type.Optional(Type.String({ description: 'Display title. Defaults to the file name.' }))
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const path = optionalString(params.path)
      if (!path) return failure('storage_write needs path')
      const created = await host.appResources.create({
        kind: 'storage',
        path,
        content: String(params.content ?? ''),
        title: optionalString(params.title)
      })
      if ('error' in created) return failure(created.error)
      return saved('Created', created)
    }
  })

  const storageEdit = defineTool({
    name: 'storage_edit',
    label: TOOL_LABELS.storage_edit,
    description:
      'Replace a file already in the app Storage catalog (存储). Pass `url` or `path`, plus the full `content`. Omit `url` to edit the Storage file open in the app column. Not a workspace source edit — those stay on fs_write.',
    parameters: Type.Object({
      url: Type.Optional(
        Type.String({ description: 'vav://app/storage?path=… URL. Omit to use the open Storage file.' })
      ),
      path: Type.Optional(Type.String({ description: 'Storage file path, when url is omitted.' })),
      content: Type.String({ description: 'Full file contents.' }),
      title: Type.Optional(Type.String({ description: 'Display title.' }))
    }),
    async execute(_id, params) {
      if (!host.appResources) return failure('App resources are unavailable')
      const explicit = optionalString(params.url)
      const path = optionalString(params.path)
      const url =
        explicit ||
        (path ? formatAppResourceUrl({ kind: 'storage', path }) : '') ||
        openAppUrl(host, 'storage', undefined)
      if (!url) return failure('Pass url or path, or open a Storage file in the app column.')
      const written = await host.appResources.write(url, String(params.content ?? ''), {
        title: optionalString(params.title),
        path
      })
      if ('error' in written) return failure(written.error)
      return saved('Updated', written)
    }
  })

  return [app, analysisWrite, analysisEdit, scheduleWrite, scheduleEdit, storageWrite, storageEdit] as const
}

function saved(
  verb: 'Created' | 'Updated',
  result: { url: string; title: string }
): { content: [{ type: 'text'; text: string }]; details: { display: string } } {
  const text = `${verb} ${result.title}\n${result.url}`
  return { content: [{ type: 'text', text }], details: { display: text } }
}

function openAppUrl(host: ToolHost, kind: AppResourceKind, explicit: string | undefined): string {
  if (explicit) return explicit
  const focused = host.appResources?.focusedUrl?.()?.trim() || ''
  return parseAppResourceUrl(focused)?.kind === kind ? focused : ''
}

function filterRows(rows: AppResourceRow[], query: string): AppResourceRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) ||
      (row.path ?? '').toLowerCase().includes(needle) ||
      row.url.toLowerCase().includes(needle)
  )
}

export function resolveAppToolPath(
  host: Pick<ToolHost, 'appResources' | 'workdir'>,
  raw: string
): string | null {
  const text = raw.trim()
  if (!text) return null
  if (isAppCatalogUrl(text)) return null
  const ref = parseAppResourceUrl(text)
  if (!ref) return null
  if (ref.path) return ref.path
  return host.appResources?.resolve(text)?.path ?? null
}

export function describeAppRef(ref: AppResourceRef): string {
  return formatAppResourceUrl(ref)
}
