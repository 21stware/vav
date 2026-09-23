import type { ToolName } from '../../shared/types.ts'

export const INTERACTIVE_TOOLS: ReadonlySet<ToolName> = new Set([
  'request',
  'ask_user_question',
  'request_for_secret'
])
export const READONLY_TOOLS: ReadonlySet<ToolName> = new Set([
  'fs_read',
  'fs_list',
  'doc_search',
  'doc_fetch',
  'web_search',
  'web_fetch',
  'sql_query',
  'knowledge_search',
  'knowledge_fetch',
  'load_skill',
  'connector',
  'computer_list',
  'computer_observe'
])
/** Auto-mode tools that pause for Approve / Deny. */
export const HIGH_RISK_TOOLS: ReadonlySet<ToolName> = new Set([
  'fs_write',
  'knowledge_write',
  'note_write',
  'note_edit',
  'analysis_write',
  'analysis_edit',
  'schedule_write',
  'schedule_edit',
  'storage_write',
  'storage_edit',
  'terminal',
  'switch_mode',
  'computer_act'
])
