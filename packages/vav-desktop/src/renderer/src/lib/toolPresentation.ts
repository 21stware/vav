/**
 * Human-facing projection of a tool card: facts the user can recognize
 * (a URL, a path, a search) and an outcome sentence — not raw I/O.
 */
import type { MessageKey } from '@shared/i18n'
import type { ToolCallBlock, ToolCallStatus, ToolName } from '@shared/types'

export type FactKind = 'url' | 'query' | 'path' | 'name' | 'sql' | 'command' | 'site' | 'reason' | 'agent'

export type PresentableFact = {
  kind: FactKind
  value: string
}

export type ToolOutcome =
  | { kind: 'none' }
  | { kind: 'body'; text: string }
  | { kind: 'empty'; headline: MessageKey }
  | {
      kind: 'error'
      headline: MessageKey
      detailKey?: MessageKey
      detailText?: string
    }

export type PresentedArgs = {
  facts: PresentableFact[]
  extraArgs: Record<string, unknown>
}

/** Transport/model keys. Never first-class facts; not enough to open a dump. */
const IMPLEMENTATION_KEYS = new Set([
  'format',
  'extract',
  'maxchars',
  'maxcharacters',
  'startline',
  'timeout',
  'timeoutms',
  'prompt',
  'raw',
  'headers',
  'offset',
  'limit',
  'background',
  'numresults',
  'maxresults',
  'stream',
  'sessionid',
  'taillines',
  'list',
  'mode'
])

const URL_KEYS = ['url', 'uri', 'href', 'link']
const QUERY_KEYS = ['query', 'q', 'search', 'pattern']
const PATH_KEYS = [
  'path',
  'file_path',
  'filepath',
  'target_file',
  'targetfile',
  'filename',
  'file'
]
const NAME_KEYS = ['name', 'skill', 'skill_name', 'skillname', 'description', 'title']
const SQL_KEYS = ['sql']
const COMMAND_KEYS = ['command', 'cmd', 'script']
const SITE_KEYS = ['site']
const REASON_KEYS = ['reason']
const AGENT_KEYS = ['agent', 'subagent_type', 'subagent', 'subagenttype']

const FACT_LABEL: Record<FactKind, MessageKey | null> = {
  url: null,
  query: 'tool.field.query',
  path: 'tool.field.path',
  name: 'tool.field.name',
  sql: 'tool.field.sql',
  command: 'tool.field.command',
  site: 'tool.field.site',
  reason: 'tool.field.reason',
  agent: 'tool.field.agent'
}

function parseArgs(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function stripUrl(value: string): string {
  return value.trim().replace(/[.,;:)\]}>]+$/g, '')
}

export function pickUrl(args: Record<string, unknown>, summary = ''): string | null {
  for (const key of URL_KEYS) {
    const value = asNonEmptyString(args[key])
    if (value && /^https?:\/\//i.test(value)) return stripUrl(value)
  }
  for (const value of Object.values(args)) {
    const text = asNonEmptyString(value)
    if (text && /^https?:\/\//i.test(text)) return stripUrl(text)
  }
  const fromSummary = summary.match(/https?:\/\/\S+/)
  return fromSummary ? stripUrl(fromSummary[0]!) : null
}

export function presentToolArgs(tool: ToolName, input: string, summary: string): PresentedArgs {
  const args = parseArgs(input)
  const used = new Set<string>()
  const facts: PresentableFact[] = []

  const url = pickUrl(args, summary)
  if (url) {
    facts.push({ kind: 'url', value: url })
    markKeysWithUrl(args, used, url)
  }

  pushPicked(facts, used, args, QUERY_KEYS, 'query')
  pushPicked(facts, used, args, PATH_KEYS, 'path')
  pushPicked(facts, used, args, NAME_KEYS, 'name')
  pushPicked(facts, used, args, AGENT_KEYS, 'agent')
  pushPicked(facts, used, args, COMMAND_KEYS, 'command')
  pushPicked(facts, used, args, SQL_KEYS, 'sql')
  pushPicked(facts, used, args, SITE_KEYS, 'site')
  pushPicked(facts, used, args, REASON_KEYS, 'reason')

  if (tool === 'web_search' && !facts.some((fact) => fact.kind === 'query')) {
    const fromSummary = summary.trim()
    if (fromSummary && !/^https?:\/\//i.test(fromSummary)) {
      facts.push({ kind: 'query', value: fromSummary })
    }
  }

  const extraArgs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (used.has(key)) continue
    extraArgs[key] = value
  }

  return { facts, extraArgs }
}

export function factLabelKey(kind: FactKind): MessageKey | null {
  return FACT_LABEL[kind]
}

export function outcomeFor(block: Pick<ToolCallBlock, 'tool' | 'output' | 'status'>): ToolOutcome {
  const output = (block.output || '').trim()
  if (isFailedStatus(block.status)) {
    const support = errorSupport(block.tool, output)
    return {
      kind: 'error',
      headline: failedHeadline(block.tool),
      detailKey: support.key,
      detailText: support.text
    }
  }
  if (block.status === 'skipped') {
    return { kind: 'empty', headline: 'common.skipped' }
  }
  if (!output) {
    if (block.status === 'executing' || block.status === 'pending') return { kind: 'none' }
    return { kind: 'empty', headline: emptyHeadline(block.tool) }
  }
  return { kind: 'body', text: output }
}

export function errorSupport(
  tool: ToolName,
  output: string
): { key?: MessageKey; text?: string } {
  if (!output) return {}
  const cleaned = stripToolPrefix(tool, output)
  if (!cleaned) return {}
  const key = classifyNetworkError(cleaned)
  if (key) return { key }
  if (looksLikeNoise(cleaned)) return {}
  return { text: cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned }
}

export function classifyNetworkError(text: string): MessageKey | null {
  const lower = text.toLowerCase()
  if (/enotfound|getaddrinfo|nxdomain|nodename nor servname|name or service not known/.test(lower)) {
    return 'tool.error.host'
  }
  if (/etimedout|timed?\s*out|timeout/.test(lower)) return 'tool.error.timeout'
  if (/econnrefused|connection refused/.test(lower)) return 'tool.error.refused'
  if (/\b403\b|forbidden/.test(lower)) return 'tool.error.forbidden'
  if (/\b401\b|unauthorized/.test(lower)) return 'tool.error.forbidden'
  if (/\b404\b|not found/.test(lower)) return 'tool.error.missing'
  if (/ssrf|private (ip|net|address)|localhost is blocked|blocked/.test(lower)) {
    return 'tool.error.blocked'
  }
  return null
}

export function prettyToolInput(input: string): string {
  const args = parseArgs(input)
  if (Object.keys(args).length === 0) {
    const trimmed = input.trim()
    return !trimmed || trimmed === '{}' ? '' : trimmed
  }
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return input
  }
}

export function shouldShowTechnical(
  extraArgs: Record<string, unknown>,
  unusedOutput: string
): boolean {
  if (unusedOutput.trim()) return true
  return Object.keys(extraArgs).some((key) => !IMPLEMENTATION_KEYS.has(normalizeKey(key)))
}

export type ParsedFetchPage = {
  title?: string
  url?: string
  body: string
}

const FETCH_META_NOISE = /^(content_type|extracted|chars|start_line):/i

/** Built-in web_fetch display: title + URL above the article, jargon stripped. */
export function parseFetchedPage(text: string): ParsedFetchPage {
  const sep = text.indexOf('\n---\n')
  const head = sep < 0 ? text : text.slice(0, sep)
  const body = sep < 0 ? '' : text.slice(sep + 5).replace(/^\n/, '')
  const lines = head
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const looksLikeMeta =
    sep >= 0 ||
    (lines.length <= 6 && lines.some((line) => line.startsWith('final_url:') || line.startsWith('web_fetch')))

  if (!looksLikeMeta) {
    return { body: text }
  }

  let title: string | undefined
  let url: string | undefined
  for (const line of lines) {
    if (line.startsWith('# ')) title = line.slice(2).trim() || title
    else if (line.startsWith('final_url:')) url = line.slice('final_url:'.length).trim() || url
    else if (FETCH_META_NOISE.test(line) || line.startsWith('web_fetch')) continue
    else if (!title && !/^[a-z_]+:/i.test(line)) title = line
  }
  return { title, url, body }
}

function isFailedStatus(status: ToolCallStatus): boolean {
  return status === 'error' || status === 'expired'
}

function failedHeadline(tool: ToolName): MessageKey {
  switch (tool) {
    case 'web_fetch':
      return 'tool.detail.failedFetch'
    case 'web_search':
      return 'tool.detail.failedSearch'
    case 'fs_read':
      return 'tool.detail.failedRead'
    case 'fs_write':
      return 'tool.detail.failedWrite'
    case 'fs_list':
      return 'tool.detail.failedList'
    case 'task':
      return 'tool.detail.failedTask'
    default:
      return 'tool.detail.failedGeneric'
  }
}

function emptyHeadline(tool: ToolName): MessageKey {
  switch (tool) {
    case 'web_fetch':
      return 'tool.detail.emptyFetch'
    case 'web_search':
      return 'tool.detail.emptySearch'
    case 'fs_read':
      return 'tool.detail.emptyRead'
    case 'fs_list':
      return 'tool.detail.emptyList'
    case 'task':
      return 'tool.detail.emptyTask'
    default:
      return 'tool.detail.emptyGeneric'
  }
}

function stripToolPrefix(tool: ToolName, output: string): string {
  let text = output.trim()
  if (tool === 'web_fetch') {
    text = text.replace(/^web_fetch failed(?: for \S+)?:\s*/i, '')
  } else if (tool === 'web_search') {
    text = text.replace(/^web_search failed[:\s]*/i, '')
  }
  return text.trim()
}

function looksLikeNoise(text: string): boolean {
  if (/^https?:\/\/\S+$/i.test(text)) return true
  if (text === '{}' || text === '(no output)' || text === '（无输出）') return true
  return false
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function pickFirst(
  args: Record<string, unknown>,
  keys: string[]
): { key: string; value: string } | null {
  for (const key of keys) {
    const match = findKey(args, key)
    if (!match) continue
    const value = asNonEmptyString(args[match])
    if (value) return { key: match, value }
  }
  return null
}

function pushPicked(
  facts: PresentableFact[],
  used: Set<string>,
  args: Record<string, unknown>,
  keys: string[],
  kind: FactKind
): void {
  if (facts.some((fact) => fact.kind === kind)) return
  const picked = pickFirst(args, keys)
  if (!picked) return
  facts.push({ kind, value: picked.value })
  used.add(picked.key)
}

function findKey(args: Record<string, unknown>, wanted: string): string | undefined {
  const needle = normalizeKey(wanted)
  return Object.keys(args).find((key) => normalizeKey(key) === needle)
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function markKeysWithUrl(args: Record<string, unknown>, used: Set<string>, url: string): void {
  for (const [key, value] of Object.entries(args)) {
    const text = asNonEmptyString(value)
    if (text && stripUrl(text) === url) used.add(key)
    else if (URL_KEYS.includes(normalizeKey(key)) || URL_KEYS.includes(key)) used.add(key)
  }
}


