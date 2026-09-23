import { APP_CATALOG_PLUGINS, appCatalogPlugin } from './appPlugins.ts'
import { brandDisplayName } from './brandIdentity.ts'
import {
  formatAppCatalogUrl,
  formatAppResourceUrl,
  parseAppResourceUrl,
  type AppResourceKind
} from './appResourceUrl.ts'

export type AppColumnFocusKind = 'storage' | 'data' | 'knowledge' | 'scheduled' | 'devices'
export type AppColumnFocusLevel = 'list' | 'item' | 'selected'

const APP_COLUMN_FOCUS_KINDS = new Set<AppColumnFocusKind>([
  'storage',
  'data',
  'knowledge',
  'scheduled',
  'devices'
])
const APP_COLUMN_FOCUS_LEVELS = new Set<AppColumnFocusLevel>(['list', 'item', 'selected'])
const FOCUS_TITLE_CAP = 200
const FOCUS_PATH_CAP = 2048

/** Structural parse for session-protocol / IPC payloads. Invalid input is dropped. */
export function parseAppColumnFocus(value: unknown): AppColumnFocus | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!APP_COLUMN_FOCUS_KINDS.has(raw.kind as AppColumnFocusKind)) return null
  if (!APP_COLUMN_FOCUS_LEVELS.has(raw.level as AppColumnFocusLevel)) return null
  if (typeof raw.title !== 'string') return null
  return {
    kind: raw.kind as AppColumnFocusKind,
    level: raw.level as AppColumnFocusLevel,
    title: raw.title.slice(0, FOCUS_TITLE_CAP),
    path: typeof raw.path === 'string' ? raw.path.slice(0, FOCUS_PATH_CAP) : null,
    objectId: typeof raw.objectId === 'string' ? raw.objectId.slice(0, 120) : null,
    url: typeof raw.url === 'string' ? raw.url.slice(0, FOCUS_PATH_CAP) : null,
    ...(typeof raw.table === 'string' || raw.table === null ? { table: raw.table } : {}),
    ...(typeof raw.selectionLabel === 'string' || raw.selectionLabel === null
      ? { selectionLabel: raw.selectionLabel }
      : {})
  }
}

/**
 * Snapshot of the right-hand app column, persisted on the workspace agent
 * so a turn can see what the user is actually looking at.
 */
export type AppColumnFocus = {
  kind: AppColumnFocusKind
  level: AppColumnFocusLevel
  title: string
  /** Real file / folder path when one exists. Not `file/table`. */
  path: string | null
  objectId: string | null
  url: string | null
  table?: string | null
  selectionLabel?: string | null
}

const KIND_LABEL: Record<AppColumnFocusKind, string> = {
  storage: appCatalogPlugin('storage')?.label ?? 'Storage',
  data: appCatalogPlugin('data')?.label ?? 'Data',
  knowledge: appCatalogPlugin('knowledge')?.label ?? 'Knowledge',
  scheduled: appCatalogPlugin('scheduled')?.label ?? 'Scheduled',
  devices: 'Devices'
}

export function appColumnFocusEqual(
  a: AppColumnFocus | null | undefined,
  b: AppColumnFocus | null | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.level === b.level &&
    a.title === b.title &&
    a.path === b.path &&
    a.objectId === b.objectId &&
    a.url === b.url &&
    (a.table ?? null) === (b.table ?? null) &&
    (a.selectionLabel ?? null) === (b.selectionLabel ?? null)
  )
}

export function isOpenAppColumnFocus(
  focus: AppColumnFocus | null | undefined
): focus is AppColumnFocus {
  return !!focus && (focus.level === 'item' || focus.level === 'selected')
}

export function appColumnResourceUrl(input: {
  kind: AppColumnFocusKind
  level: AppColumnFocusLevel
  objectId?: string | null
  path?: string | null
  knowledgeHostId?: string | null
}): string | null {
  if (input.kind === 'devices') return null
  const kind = input.kind as AppResourceKind
  if (input.kind === 'data') {
    return formatAppResourceUrl({
      kind: 'data',
      ...(input.objectId ? { id: input.objectId } : {}),
      ...(input.path ? { path: input.path } : {})
    })
  }
  if (input.kind === 'knowledge') {
    const id = input.knowledgeHostId || input.objectId
    return formatAppResourceUrl({
      kind: 'knowledge',
      ...(id ? { id } : {}),
      ...(input.path ? { path: input.path } : {})
    })
  }
  if (input.kind === 'scheduled') {
    return input.objectId
      ? formatAppResourceUrl({ kind: 'scheduled', id: input.objectId })
      : formatAppResourceUrl({ kind: 'scheduled' })
  }
  if (input.path) {
    return formatAppResourceUrl({
      kind: 'storage',
      path: input.path,
      ...(input.level === 'list' ? { dir: true } : {}),
      ...(input.objectId ? { id: input.objectId } : {})
    })
  }
  return input.level === 'list' ? formatAppCatalogUrl() : formatAppResourceUrl({ kind })
}

/** Conversation / knowledge-host / file id encoded on the focus URL. */
export function appColumnFocusResourceId(focus: AppColumnFocus): string | null {
  return parseAppResourceUrl(focus.url)?.id?.trim() || focus.objectId?.trim() || null
}

/**
 * Ambient system-prompt body. Tells the model what the app column is showing
 * so "this dataset" / "当前这个" resolve without searching the workdir.
 */
export function formatAppColumnFocusForPrompt(focus: AppColumnFocus): string {
  const kind = KIND_LABEL[focus.kind]
  const url = focus.url?.trim() || null
  const resourceId = appColumnFocusResourceId(focus)
  if (focus.level === 'list') {
    const highlighted = focus.title.trim() && focus.objectId
    const where = focus.path
      ? `browsing ${kind}: ${focus.title || focus.path}`
      : highlighted
        ? `browsing the ${kind} catalog; “${focus.title}” is highlighted but not open`
        : `browsing the ${kind} catalog (no object is open)`
    return [
      `Current app column: ${where}.`,
      url ? `Catalog: ${url}` : null,
      `When they say "this" / "当前" they mean this ${kind} catalog — not a hidden file in the working directory.`,
      `Use the \`app\` tool (\`op: "list"\`, kind ${focus.kind}) for names. Create in this catalog with \`app\` \`op: "create"\` kind ${focus.kind}. Do not search the working directory.`,
      'This block is live UI state for this turn. Do not list other catalogs to find the current page.'
    ]
      .filter((line): line is string => !!line)
      .join('\n')
  }

  const lines = [
    `Current app column: ${kind} · ${focus.title || 'open item'} (${focus.level === 'selected' ? 'open, with a selection' : 'open'}).`,
    url ? `Resource: ${url}` : null,
    resourceId && focus.kind === 'knowledge' ? `Knowledge host id: ${resourceId}` : null,
    focus.path ? `Path: ${focus.path}` : null
  ]

  if (focus.kind === 'data') {
    const table = focus.table?.trim()
    lines.push(
      table
        ? `They are viewing table \`${table}\`. When they say "this dataset" / "this table" / "当前这个数据集" / "这张表", they mean this Data object / table \`${table}\`.`
        : `When they say "this dataset" / "当前这个数据集", they mean this Data object.`,
      'Prefer `sql_query` on this resource (omit path on a live connection; pass the path above for a file). Do not search the working directory for data files.',
      'Update it with `analysis_edit` (omit `url`; this Resource URL is already in context). Create another with `analysis_write` (`path` for a CSV/SQLite/Parquet file, or `connection_url` for a live database).',
      'Do not `app list` / search the workdir to rediscover this dataset — the Resource URL and path above are already in context.'
    )
  } else if (focus.kind === 'knowledge') {
    const name = focus.title.trim() || 'this note'
    lines.push(
      `When they say "this note" / "这篇笔记" / "当前这个", they mean “${name}”.`,
      resourceId
        ? `Read it with \`knowledge_fetch\` \`host_id: "${resourceId}"\` (or \`app\` \`op: get\` on the Resource URL). Rewrite it with \`note_edit\` \`host_id: "${resourceId}"\`. Create another note with \`note_write\`.`
        : 'Read this note with `knowledge_fetch` (or `app` `op: get`). Rewrite it with `note_edit`. Create another note with `note_write`.',
      'Do not `app list` / `knowledge_search` / search the working directory first unless they ask about other notes.'
    )
  } else if (focus.kind === 'storage') {
    lines.push(
      'This is the open Storage file. Read it from the path above. Replace it with `storage_edit`. Add another Storage file with `storage_write`. Do not search the folder unless they ask.',
      'Do not `app list` to rediscover this file — the path above is already in context.'
    )
  } else if (focus.kind === 'scheduled') {
    lines.push(
      'They are editing this scheduled task. Read it with `app` `op: get`. Update it with `schedule_edit` (title, prompt, schedule, enabled).',
      'Create another task with `schedule_write`.',
      'Do not `app list` to rediscover this task — the Resource URL above is already in context.'
    )
  }

  if (focus.selectionLabel?.trim()) {
    lines.push(`Selection: ${focus.selectionLabel.trim()}.`)
  }

  return lines.filter((line): line is string => !!line).join('\n')
}

/**
 * Hidden prefix on the outbound user turn (bubble stays user-typed).
 * Models attend to this more reliably than a buried system-prompt block.
 */
export function formatAppColumnSendContext(focus: AppColumnFocus | null | undefined): string {
  if (!focus) return ''
  const kind = KIND_LABEL[focus.kind]
  const product = brandDisplayName()
  const noun = appCatalogPlugin(focus.kind)?.noun ?? 'file'
  return [
    `## ${product} app context`,
    `The user selected this ${noun} in ${product}'s app column for this message.`,
    focus.kind === 'knowledge'
      ? `"Note" / "the note" / "这篇笔记" means this ${product} Knowledge note — not Apple Notes, MacVise, Obsidian, or any other notes app.`
      : `When they say "this" / "当前" they mean this ${kind} item — not something you have to go find.`,
    formatAppColumnFocusForPrompt(focus)
  ].join('\n')
}

/**
 * Standing instructions: the app column is first-class, not the workdir.
 * Always attached so the model can list / create / edit even with no focus.
 */
export function formatAppColumnCapabilitiesForPrompt(
  focus?: AppColumnFocus | null
): string {
  const current = focus && focus.kind !== 'devices' ? KIND_LABEL[focus.kind] : null
  const kindList = APP_CATALOG_PLUGINS.map((plugin) => plugin.id).join(' | ')
  const toolList = APP_CATALOG_PLUGINS.map(
    (plugin) => `\`${plugin.tools.write}\` / \`${plugin.tools.edit}\``
  ).join(', ')
  const lines = [
    '## App column',
    'The right-hand app column is a separate catalog from this conversation working directory.',
    'It holds Storage files, Data (analysis: live databases and CSV/SQLite/Parquet), Knowledge notes, and Scheduled tasks.',
    'Never search the working directory for those objects. Use the `app` tool and `vav://app/…` URLs.',
    `Create and edit app objects with their own tools, not \`fs_write\`: ${toolList}.`,
    '',
    'Management (`app` tool):',
    `- \`op: list\` / \`search\` — catalogs. Pass \`kind\`: ${kindList}.`,
    '- `op: get` — read one item (`url`).',
    '- `op: create` — mint a new item. Pass `kind` plus the fields below.',
    '- `op: write` — update an existing item (`url`).',
    '- `op: delete` — remove / archive.',
    '',
    'Create / write fields:',
    '- Analysis: `analysis_write` / `analysis_edit`. `path` (CSV/TSV/SQLite/Parquet) or `connection_url` (postgres/mysql/clickhouse/…). Then `sql_query`. Live SQL is read-only.',
    '- Knowledge: `note_write` / `note_edit`. `markdown` is the full note.',
    '- Scheduled: `schedule_write` / `schedule_edit`. `prompt` is the task, `schedule` is `0 9 * * *`, `every 1h`, an ISO datetime, or JSON. New tasks stay disabled unless `enabled` is true.',
    '- Storage: `storage_write` / `storage_edit`. `path` + `content`.'
  ]
  if (current) {
    lines.push(
      '',
      `You are on the ${current} page — prefer ${current} tools for "this" / "当前". List and create in this catalog unless they name another.`
    )
  }
  if (focus && (focus.level === 'item' || focus.level === 'selected')) {
    lines.push(
      '',
      'The Current app column block above is live for this turn. Use those ids / URLs / paths directly. Do not list catalogs or the working directory just to find the open item.'
    )
  }
  return lines.join('\n')
}

/** Compact TUI paste — same facts, fewer lines. */
export function formatAppColumnFocusBrief(focus: AppColumnFocus): string {
  const kind = KIND_LABEL[focus.kind]
  if (focus.level === 'list') {
    return [`[${brandDisplayName()}] App · ${kind}`, focus.path || focus.title || 'catalog'].join('\n')
  }
  const table = focus.table?.trim()
  const title = table && !focus.title.includes(table) ? `${focus.title} · ${table}` : focus.title
  return [
    `[${brandDisplayName()}] App · ${kind} · ${title || 'open'}`,
    focus.path || focus.url || '',
    focus.kind === 'data'
      ? 'Query this dataset for the request below.'
      : 'Use this open item for the request below.'
  ]
    .filter(Boolean)
    .join('\n')
}

export type AgentAppBindingSource = {
  id: string
  sessionKind?: string | null
  dbConnectionId?: string | null
  dataFilePath?: string | null
  focusedDbTable?: string | null
  focusedFilePath?: string | null
  knowledgeHostId?: string | null
  fileId?: string | null
  appColumnFocus?: AppColumnFocus | null
}

export type AgentAppBindings = {
  focus: AppColumnFocus | null
  source: AgentAppBindingSource
  dbConnectionId: string | null
  dataFilePath: string | null
  dbTable: string | null
  knowledgeHostId: string | null
  fileId: string | null
  openFilePath: string | null
  dbSession: boolean
}

/**
 * Workspace agents inherit bindings from the open app object.
 * List / collapsed app does not pin an object as the live dataset.
 */
export function resolveAgentAppBindings(
  conversation: AgentAppBindingSource,
  lookup: (id: string) => AgentAppBindingSource | undefined
): AgentAppBindings {
  const focus = conversation.appColumnFocus ?? null
  const object =
    isOpenAppColumnFocus(focus) && focus.objectId && focus.objectId !== conversation.id
      ? lookup(focus.objectId)
      : undefined
  const source = object ?? conversation
  const dbConnectionId = source.dbConnectionId?.trim() || null
  const dataFilePath = source.dataFilePath?.trim() || null
  const dbTable =
    focus?.table?.trim() || source.focusedDbTable?.trim() || null
  const openFilePath =
    conversation.focusedFilePath?.trim() ||
    dataFilePath ||
    source.focusedFilePath?.trim() ||
    null
  return {
    focus,
    source,
    dbConnectionId,
    dataFilePath,
    dbTable,
    knowledgeHostId: source.knowledgeHostId?.trim() || null,
    fileId: source.fileId?.trim() || null,
    openFilePath,
    dbSession: source.sessionKind === 'db' || Boolean(dbConnectionId)
  }
}
