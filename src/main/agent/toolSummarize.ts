import { normalizeAskQuestions, normalizePlanSteps } from '../../shared/askPlan.ts'
import { TOOL_OUTPUT_CAP, type ToolName } from '../../shared/types.ts'

/** Default sticky-shell session id (`StickyShell.BASH_SESSION_ID`). */
export const DEFAULT_BASH_SESSION_ID = 'bash'

/** Keeps head and tail so the model sees both the command echo and the result. */
export function cap(text: string, limit = TOOL_OUTPUT_CAP): string {
  if (text.length <= limit) return text
  const half = Math.floor(limit / 2)
  const omitted = text.length - limit
  return `${text.slice(0, half)}\n\n…[${omitted} characters omitted]…\n\n${text.slice(-half)}`
}

/** Heuristic: commands that typically never exit on their own. */
export function looksLikeServerCommand(command: string): boolean {
  const c = command.trim()
  return (
    /\b(npm|pnpm|yarn|bunx?)\s+(run\s+)?(dev|start|serve)\b/i.test(c) ||
    /\b(npx|bunx)\s+(vite|next|react-scripts|webpack-dev-server)\b/i.test(c) ||
    /\b(vite|next\s+dev|webpack-dev-server|nodemon|uvicorn|gunicorn|fastapi)\b/i.test(c) ||
    /\b(flask|django-admin|manage\.py)\s+run(server)?\b/i.test(c) ||
    /\brails\s+s(erver)?\b/i.test(c) ||
    /\bpython\d*\s+-m\s+http\.server\b/i.test(c) ||
    /\b(php|ruby)\s+-S\b/i.test(c) ||
    /\b(--watch|-w)\b/.test(c)
  )
}

export function truncateToolSummary(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** One-line label shown on the collapsed tool card. */
export function summarizeToolInput(
  tool: ToolName,
  input: Record<string, unknown>,
  bashSessionId = DEFAULT_BASH_SESSION_ID
): string {
  switch (tool) {
    case 'terminal': {
      const cmd = truncateToolSummary(String(input.command ?? ''), 100)
      return input.background ? `${cmd} (background)` : cmd
    }
    case 'wait':
      return truncateToolSummary(`expect: ${String(input.expect ?? '')}`, 120)
    case 'read_bash_session':
      return `tailLines: ${String(input.tailLines ?? 200)}, sessionId: ${String(input.sessionId ?? bashSessionId)}`
    case 'fs_read':
    case 'fs_write':
      return truncateToolSummary(String(input.path ?? ''), 120)
    case 'fs_list':
      return truncateToolSummary(String(input.path ?? '.'), 120)
    case 'doc_search': {
      const q = String(input.query ?? '')
      const related = input.related_to_selection ? ' · related' : ''
      return truncateToolSummary(`${String(input.path ?? '')} ${q}${related}`.trim(), 120)
    }
    case 'doc_fetch':
      return truncateToolSummary(
        `${String(input.path ?? '')} ids=${JSON.stringify(input.ids ?? [])} page=${String(input.page ?? '')}`,
        120
      )
    case 'sql_query':
      return truncateToolSummary(
        `${String(input.path ?? '')} ${String(input.sql ?? '').replace(/\s+/g, ' ')}`.trim(),
        120
      )
    case 'web_search': {
      const site = input.site ? ` site:${String(input.site)}` : ''
      return truncateToolSummary(`${String(input.query ?? '')}${site}`.trim(), 120)
    }
    case 'web_fetch':
      return truncateToolSummary(String(input.url ?? ''), 120)
    case 'load_skill': {
      if (input.list || (!input.name && !input.url)) return 'list catalog'
      if (input.url) return truncateToolSummary(`url: ${String(input.url)}`, 120)
      const p = input.path ? ` / ${String(input.path)}` : ''
      return truncateToolSummary(`${String(input.name ?? '')}${p}`, 120)
    }
    case 'request':
      return truncateToolSummary(String(input.instruction ?? ''), 120)
    case 'ask_user_question': {
      const questions = normalizeAskQuestions(input)
      if (questions.length > 1) {
        return truncateToolSummary(String(input.title ?? `${questions.length} 个问题`), 120)
      }
      return truncateToolSummary(questions[0]?.question ?? String(input.question ?? ''), 120)
    }
    case 'plan': {
      const steps = normalizePlanSteps(input.steps)
      const done = steps.filter((step) => step.status === 'done').length
      return truncateToolSummary(
        `Plan · ${String(input.title ?? 'Plan')} (${done}/${steps.length || 0})`,
        120
      )
    }
    case 'switch_mode': {
      const reason = String(input.reason ?? '').trim()
      return reason ? truncateToolSummary(`Switch to Edit · ${reason}`, 120) : 'Switch to Edit'
    }
    case 'task': {
      const desc = String(input.description ?? input.title ?? '').trim()
      const agent = String(input.agent ?? input.subagent_type ?? input.subagent ?? '').trim()
      if (desc && agent) return truncateToolSummary(`${agent} · ${desc}`, 120)
      return truncateToolSummary(desc || agent || String(input.prompt ?? ''), 120)
    }
    case 'plan_doc': {
      const name = String(input.name ?? input.title ?? '').trim()
      const overview = String(input.overview ?? '').trim()
      return truncateToolSummary(overview || name, 120)
    }
    default:
      return ''
  }
}
