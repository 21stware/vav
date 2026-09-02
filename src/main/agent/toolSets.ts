import type { ToolName } from '../../shared/types.ts'

export const INTERACTIVE_TOOLS: ReadonlySet<ToolName> = new Set(['request', 'ask_user_question'])
export const READONLY_TOOLS: ReadonlySet<ToolName> = new Set([
  'fs_read',
  'fs_list',
  'doc_search',
  'doc_fetch',
  'web_search',
  'web_fetch',
  'sql_query',
  'load_skill'
])
/** Auto-mode tools that pause for Approve / Deny. */
export const HIGH_RISK_TOOLS: ReadonlySet<ToolName> = new Set([
  'fs_write',
  'terminal',
  'switch_mode'
])
