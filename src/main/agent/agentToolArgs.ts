import type { ToolName } from '../../shared/types.ts'

/**
 * Streaming tool args for the card: keep identity fields, drop bulky bodies.
 * Full arguments land on toolcall_end via `blockFromContent`.
 */
export function leanToolArgs(tool: ToolName, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'fs_write': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (args.contents !== undefined) lean.contents = '…'
      return lean
    }
    case 'fs_read':
    case 'fs_list': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      return lean
    }
    case 'doc_search': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (typeof args.query === 'string') lean.query = args.query
      if (args.related_to_selection !== undefined) {
        lean.related_to_selection = args.related_to_selection
      }
      if (args.top_k !== undefined) lean.top_k = args.top_k
      return lean
    }
    case 'doc_fetch': {
      const lean: Record<string, unknown> = {}
      if (typeof args.path === 'string') lean.path = args.path
      if (args.ids !== undefined) lean.ids = args.ids
      if (args.page !== undefined) lean.page = args.page
      if (args.section_id !== undefined) lean.section_id = args.section_id
      return lean
    }
    case 'web_search': {
      const lean: Record<string, unknown> = {}
      if (typeof args.query === 'string') lean.query = args.query
      if (args.num_results !== undefined) lean.num_results = args.num_results
      if (typeof args.site === 'string') lean.site = args.site
      return lean
    }
    case 'web_fetch': {
      const lean: Record<string, unknown> = {}
      if (typeof args.url === 'string') lean.url = args.url
      if (args.extract !== undefined) lean.extract = args.extract
      if (args.max_chars !== undefined) lean.max_chars = args.max_chars
      if (args.start_line !== undefined) lean.start_line = args.start_line
      return lean
    }
    case 'terminal': {
      const lean: Record<string, unknown> = {}
      if (typeof args.command === 'string') lean.command = args.command
      if (args.background !== undefined) lean.background = args.background
      return lean
    }
    case 'request':
      return typeof args.instruction === 'string' ? { instruction: args.instruction } : {}
    case 'ask_user_question': {
      // Keep choices / multiSelect so the renderer can rebuild single- and
      // multi-select cards from persisted input (not free-text-only).
      const lean: Record<string, unknown> = {}
      if (args.question !== undefined) lean.question = args.question
      if (args.choices !== undefined) lean.choices = args.choices
      if (args.multiSelect !== undefined) lean.multiSelect = args.multiSelect
      if (args.questions !== undefined) lean.questions = args.questions
      if (args.title !== undefined) lean.title = args.title
      return lean
    }
    case 'plan': {
      const lean: Record<string, unknown> = {}
      if (args.title !== undefined) lean.title = args.title
      if (args.steps !== undefined) lean.steps = args.steps
      return lean
    }
    case 'plan_doc': {
      const lean: Record<string, unknown> = {}
      if (args.name !== undefined) lean.name = args.name
      if (args.overview !== undefined) lean.overview = args.overview
      if (args.plan !== undefined) lean.plan = args.plan
      if (args.todos !== undefined) lean.todos = args.todos
      if (args.phases !== undefined) lean.phases = args.phases
      return lean
    }
    default:
      return args
  }
}

/** Merge a user's edited approval payload back into tool args. */
export function applyEditedArgs(
  name: ToolName,
  original: unknown,
  edited: string
): Record<string, unknown> | null {
  const base =
    original && typeof original === 'object' ? { ...(original as Record<string, unknown>) } : {}
  if (name === 'terminal') {
    return { ...base, command: edited }
  }
  if (name === 'fs_read' || name === 'fs_write' || name === 'fs_list') {
    return { ...base, path: edited }
  }
  if (name === 'web_fetch') {
    return { ...base, url: edited }
  }
  if (name === 'web_search') {
    return { ...base, query: edited }
  }
  try {
    const parsed = JSON.parse(edited) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // not JSON
  }
  return null
}
