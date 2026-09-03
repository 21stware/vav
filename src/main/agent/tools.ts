/**
 * vav's tools, expressed as pi `AgentTool`s.
 *
 * These are deliberately not pi's built-ins. `terminal` writes into the
 * conversation's sticky shell so `cd` and `export` survive between calls and
 * the transcript can be mirrored into the Agent terminal tab; `request` and
 * `ask_user_question` park the turn on a promise the renderer resolves. Both
 * behaviours are product decisions pi's `bash` tool would undo.
 *
 * Each tool returns two things: `content` is what the model reads (capped), and
 * `details.display` is what the card shows (full). Expected failures — a
 * missing file, a non-zero exit — come back as normal results carrying
 * `details.failed`, which the runtime lifts into pi's `isError` from
 * `afterToolCall`. Only genuinely unexpected faults throw.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ToolHost } from './toolHost'
import { createShellTools } from './toolsShell'
import { createFsTools } from './toolsFs'
import { createDocTools } from './toolsDoc'
import { createWebTools } from './toolsWeb'
import { createInteractiveTools } from './toolsInteractive'

export { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
export { summarizeToolInput } from './toolSummarize'
export { buildSystemPrompt } from './systemPrompt'
export type { ToolDetails, ToolHost } from './toolHost'
export { INTERACTIVE_TOOLS, READONLY_TOOLS, HIGH_RISK_TOOLS } from './toolSets'

export {
  FILE_READONLY_BLOCKED_TOOLS,
  isFileEditLockedPath,
  isReadonlyTerminalCommand
} from './fileEditLock'

export function createTools(host: ToolHost): AgentTool[] {
  const [terminal, wait, readBashSession] = createShellTools(host)
  const [fsRead, fsWrite, fsList] = createFsTools(host)
  const [docSearch, docFetch, sqlQuery] = createDocTools(host)
  const [webSearch, webFetch] = createWebTools(host)
  const { request, askUserQuestion, loadSkill, plan, switchMode } = createInteractiveTools(host)

  const tools: AgentTool[] = [
    terminal,
    wait,
    readBashSession,
    fsRead,
    fsWrite,
    fsList,
    docSearch,
    docFetch,
    sqlQuery,
    webSearch,
    webFetch,
    loadSkill,
    request,
    askUserQuestion,
    plan
  ]
  // File-preview Read: offer Switch to Edit so the agent can request write access.
  if (host.isFileReadOnly?.()) tools.push(switchMode)
  return tools
}
