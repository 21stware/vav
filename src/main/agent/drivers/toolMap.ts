import type { ToolName } from '@shared/types'
import { asRecord, asString } from './process'

/** Map a CLI tool name onto VAV's ToolName (for card chrome / grouping). */
export function mapToolName(name: string): ToolName {
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (
    n === 'bash' ||
    n === 'shell' ||
    n === 'terminal' ||
    n === 'run_terminal_cmd' ||
    n === 'execute_command' ||
    n === 'command_execution' ||
    n.includes('bash') ||
    n.includes('shell')
  ) {
    return 'terminal'
  }
  if (
    n === 'read' ||
    n === 'read_file' ||
    n === 'fs_read' ||
    n === 'view' ||
    n === 'cat' ||
    n.includes('read_file')
  ) {
    return 'fs_read'
  }
  if (
    n === 'write' ||
    n === 'write_file' ||
    n === 'fs_write' ||
    n === 'create_file' ||
    n === 'edit' ||
    n === 'edit_file' ||
    n === 'apply_patch' ||
    n === 'strreplace' ||
    n === 'str_replace' ||
    n === 'multiedit' ||
    n.includes('write_file') ||
    n.includes('apply_patch')
  ) {
    return 'fs_write'
  }
  if (n === 'glob' || n === 'ls' || n === 'list_dir' || n === 'fs_list' || n.includes('list_dir')) {
    return 'fs_list'
  }
  if (n === 'grep' || n === 'search' || n === 'rg' || n.includes('grep') || n.includes('search')) {
    return 'doc_search'
  }
  if (n.includes('web_search') || n === 'websearch') return 'web_search'
  if (n.includes('web_fetch') || n === 'webfetch' || n === 'fetch') return 'web_fetch'
  if (n === 'todowrite' || n === 'todo_write' || n === 'plan' || n === 'update_plan') return 'plan'
  if (n.includes('ask') || n === 'askuserquestion') return 'ask_user_question'
  return 'external'
}

export function summarizeCliTool(name: string, input: unknown): string {
  const args = asRecord(input) ?? {}
  const command =
    asString(args.command) ||
    asString(args.cmd) ||
    asString(args.script) ||
    asString(args.code)
  if (command) return truncate(command, 80)

  const path =
    asString(args.path) ||
    asString(args.file_path) ||
    asString(args.filePath) ||
    asString(args.filename) ||
    asString(args.target_file) ||
    asString(args.targetFile)
  if (path) return truncate(path, 80)

  const query = asString(args.query) || asString(args.pattern) || asString(args.prompt)
  if (query) return truncate(query, 80)

  const url = asString(args.url)
  if (url) return truncate(url, 80)

  const description = asString(args.description) || asString(args.title)
  if (description) return truncate(description, 80)

  return name
}

function truncate(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

export function inputJson(input: unknown): string {
  try {
    return JSON.stringify(input ?? {})
  } catch {
    return '{}'
  }
}
