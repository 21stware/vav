/**
 * Human tool names for the agent log. `tool` on the wire is the schema id
 * (`fs_read`); the card shows "读取文件" / "Read file".
 */
import { t, type AppLocale, type MessageKey } from './i18n/index.ts'
import { TOOL_LABELS, type ToolName } from './types.ts'

const TOOL_NAME_KEYS: Partial<Record<ToolName, MessageKey>> = {
  terminal: 'tool.shell',
  fs_read: 'tool.read',
  fs_write: 'tool.write',
  fs_list: 'tool.list',
  web_search: 'tool.webSearch',
  web_fetch: 'tool.webFetch',
  load_skill: 'tool.loadSkill',
  ask_user_question: 'tool.ask',
  request: 'tool.ask',
  switch_mode: 'tool.switchMode',
  task: 'tool.task',
  plan_doc: 'tool.planDoc'
}

const TOOL_IDS = new Set<string>(Object.keys(TOOL_LABELS))

function isToolName(value: string): value is ToolName {
  return TOOL_IDS.has(value)
}

/** CLI leftovers that sometimes leak past mapToolName. */
const ALIASES: Record<string, ToolName> = {
  read: 'fs_read',
  read_file: 'fs_read',
  write: 'fs_write',
  write_file: 'fs_write',
  shell: 'terminal',
  bash: 'terminal',
  grep: 'doc_search',
  glob: 'fs_list',
  ls: 'fs_list'
}

export function toolDisplayName(tool: string, locale: AppLocale = 'zh-CN'): string {
  const id = ALIASES[tool] ?? (isToolName(tool) ? tool : null)
  if (id) {
    const key = TOOL_NAME_KEYS[id]
    if (key) return t(locale, key)
    return locale === 'en' ? humanizeToolId(id) : TOOL_LABELS[id]
  }
  return humanizeToolId(tool)
}

function humanizeToolId(id: string): string {
  const trimmed = id.replace(/^cursor[_/]/, '').replace(/[_-]+/g, ' ').trim()
  if (!trimmed) return id
  return trimmed.replace(/\b\w/g, (ch) => ch.toUpperCase())
}
