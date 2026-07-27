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
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { Type, type TSchema } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
import {
  TOOL_LABELS,
  TOOL_OUTPUT_CAP,
  type AppSettings,
  type AskQuestion,
  type ToolName
} from '@shared/types'
import type { FileService } from '../fs/FileService'
import { BASH_SESSION_ID, type StickyShell } from '../terminal/StickyShell'
import { unifiedDiff } from './diff'

export { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'

export interface ToolDetails {
  /** Full human-facing text for the tool card. */
  display: string
  /** Expected failure: the model should see an error, the card should say 失败. */
  failed?: boolean
}

export interface ToolHost {
  workdir: string
  settings: () => AppSettings
  files: FileService
  shell: () => StickyShell
  /** Display-only: mirrors a terminal transcript into the Agent tab. */
  mirror: (text: string) => void
  fsChanged: (parentPath: string, filePath: string) => void
  /** Parks the turn until the renderer answers this card. */
  ask: (
    toolCallId: string,
    summary: string,
    options?: {
      choices?: string[]
      multiSelect?: boolean
      questions?: AskQuestion[]
      askTitle?: string
    }
  ) => Promise<{ text: string; cancelled: boolean }>
}

export const INTERACTIVE_TOOLS: ReadonlySet<ToolName> = new Set(['request', 'ask_user_question'])
export const READONLY_TOOLS: ReadonlySet<ToolName> = new Set(['fs_read', 'fs_list'])
/** Auto-mode tools that pause for Approve / Deny. */
export const HIGH_RISK_TOOLS: ReadonlySet<ToolName> = new Set(['fs_write', 'terminal'])
/** Terminal commands treated as read-only under Auto approval. */
const READONLY_TERMINAL = /^(?:cat|ls|grep|rg|head|tail|wc|pwd|echo|which|type|file|stat|find|tree)\b/

export function isReadonlyTerminalCommand(command: string): boolean {
  return READONLY_TERMINAL.test(command.trim())
}

/** Keeps the parameter schema bound to `execute`, which `AgentTool[]` erases. */
function defineTool<S extends TSchema>(tool: AgentTool<S, ToolDetails>): AgentTool<S, ToolDetails> {
  return tool
}

export function createTools(host: ToolHost): AgentTool[] {
  const inWorkdir = (path: string): string =>
    isAbsolute(path) ? path : resolvePath(host.workdir, path)

  const terminal = defineTool({
    name: 'terminal',
    label: TOOL_LABELS.terminal,
    description:
      'Run a shell command. Wait mode (default) blocks until exit. Fire-and-forget (background=true) starts services/daemons and returns immediately with {status,pid,sessionId}; then use wait or read_bash_session.',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell command to run.' }),
      background: Type.Optional(
        Type.Boolean({
          description:
            'Fire-and-forget: for servers/daemons that do not exit (npm run dev, uvicorn, …). Returns immediately; follow with wait / read_bash_session.'
        })
      )
    }),
    async execute(_id, params) {
      const command = params.command.trim()
      if (!command) return failure('缺少 command 参数')

      const timeout = host.settings().commandTimeout
      const background = params.background === true || looksLikeServerCommand(command)
      const shell = host.shell()
      host.mirror(`$ ${command}${background ? '  # background' : ''}\n`)
      const result = background
        ? await shell.runBackground(command, (chunk) => host.mirror(chunk))
        : await shell.run(command, timeout, (chunk) => host.mirror(chunk))

      if (result.timedOut) {
        host.mirror(`exit ${result.exitCode}\n`)
        return {
          content: [
            { type: 'text', text: cap(`Command timed out after ${timeout}s.\n${result.output}`) }
          ],
          details: {
            display: `命令超时（${timeout}s），已终止该次 terminal 工具。\n${result.output}`,
            failed: true
          }
        }
      }
      if (result.backgroundPid != null) {
        const payload = {
          status: 'running' as const,
          pid: result.backgroundPid,
          sessionId: shell.sessionId
        }
        host.mirror(`background pid ${result.backgroundPid}\n`)
        return {
          // Spec: empty body to the model for fire-and-forget — status JSON only.
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          details: {
            display: `后台运行 · pid ${result.backgroundPid}`,
            failed: false
          }
        }
      }
      const body = result.output
      const transcript = `$ ${command}\n${body}${body && !body.endsWith('\n') ? '\n' : ''}exit ${result.exitCode}\n`
      host.mirror(`exit ${result.exitCode}\n`)
      return {
        content: [{ type: 'text', text: cap(`${result.output}\n[exit ${result.exitCode}]`) }],
        details: { display: transcript, failed: result.exitCode !== 0 }
      }
    }
  })

  const wait = defineTool({
    name: 'wait',
    label: TOOL_LABELS.wait,
    description:
      'Wait for a previously fire-and-forget terminal session to print a pattern (e.g. "listening on"). Blocks until match or timeout.',
    parameters: Type.Object({
      sessionId: Type.Optional(
        Type.String({ description: `Bash session id (default "${BASH_SESSION_ID}").` })
      ),
      expect: Type.String({
        description: 'Regex or literal substring to watch for in stdout/stderr.'
      }),
      timeoutMs: Type.Optional(
        Type.Number({ description: 'Milliseconds to wait (default 60000).' })
      )
    }),
    async execute(_id, params) {
      const sessionId = String(params.sessionId ?? BASH_SESSION_ID)
      const shell = host.shell()
      if (sessionId !== shell.sessionId) {
        return failure(`未知 sessionId「${sessionId}」（当前仅支持 ${shell.sessionId}）`)
      }
      const expect = String(params.expect ?? '').trim()
      if (!expect) return failure('缺少 expect 参数')
      const timeoutMs = Number(params.timeoutMs ?? 60_000)
      const result = await shell.waitFor(expect, timeoutMs)
      const seconds = (result.elapsedMs / 1000).toFixed(1)
      if (result.matched) {
        return {
          content: [
            {
              type: 'text',
              text: cap(
                JSON.stringify({
                  matched: true,
                  output_since_start: result.output,
                  elapsedMs: result.elapsedMs
                })
              )
            }
          ],
          details: {
            display: `matched: ${expect} (${seconds}s)\n${result.output}`,
            failed: false
          }
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: cap(
              JSON.stringify({
                matched: false,
                output_since_start: result.output,
                elapsedMs: result.elapsedMs
              })
            )
          }
        ],
        details: {
          display: `timeout ${seconds}s · expect: ${expect}\n${result.output || '（无新输出）'}`,
          failed: true
        }
      }
    }
  })

  const readBashSession = defineTool({
    name: 'read_bash_session',
    label: TOOL_LABELS.read_bash_session,
    description:
      'Read the current scrollback of the bash session without waiting. Use to poll a fire-and-forget service.',
    parameters: Type.Object({
      sessionId: Type.Optional(
        Type.String({ description: `Bash session id (default "${BASH_SESSION_ID}").` })
      ),
      tailLines: Type.Optional(
        Type.Number({ description: 'How many trailing lines to return (default 200).' })
      )
    }),
    async execute(_id, params) {
      const sessionId = String(params.sessionId ?? BASH_SESSION_ID)
      const shell = host.shell()
      if (sessionId !== shell.sessionId) {
        return failure(`未知 sessionId「${sessionId}」（当前仅支持 ${shell.sessionId}）`)
      }
      const tail = shell.readTail(Number(params.tailLines ?? 200))
      return {
        content: [{ type: 'text', text: cap(tail || '(empty)') }],
        details: { display: tail || '（空）' }
      }
    }
  })

  const fsRead = defineTool({
    name: 'fs_read',
    label: TOOL_LABELS.fs_read,
    description:
      'Read a UTF-8 text file. Relative paths resolve against the conversation working directory.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' })
    }),
    async execute(_id, params) {
      const result = await host.files.readTextFile(inWorkdir(params.path))
      if (result.error) return failure(result.error)
      return {
        content: [{ type: 'text', text: cap(result.content) }],
        details: { display: result.content }
      }
    }
  })

  const fsWrite = defineTool({
    name: 'fs_write',
    label: TOOL_LABELS.fs_write,
    description:
      'Create or overwrite a UTF-8 text file, creating parent directories as needed. Relative paths resolve against the conversation working directory.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
      content: Type.String({ description: 'Full file contents to write.' })
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      // What changed only exists before the write lands, so capture it first.
      const previous = await host.files.readTextFile(path)
      const before = previous.error || previous.truncated ? null : previous.content

      const result = await host.files.writeTextFile(path, params.content)
      if (!result.ok) return failure(result.error ?? '写入失败')
      // Only the parent directory is refreshed; never the whole tree.
      host.fsChanged(dirname(path), path)

      const written = `已写入 ${path}（${params.content.length} 字符）`
      const diff = previous.truncated ? null : unifiedDiff(before, params.content)
      return {
        content: [{ type: 'text', text: `Wrote ${path} (${params.content.length} chars)` }],
        details: { display: diff ?? (before === params.content ? `${written}，内容未变化` : written) }
      }
    }
  })

  const fsList = defineTool({
    name: 'fs_list',
    label: TOOL_LABELS.fs_list,
    description: 'List one directory level. Ignores .git, node_modules and .DS_Store.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: 'Directory path; defaults to the workdir.' })
      )
    }),
    async execute(_id, params) {
      const listing = await host.files.listDirectory(inWorkdir(params.path ?? '.'))
      if (listing.error) return failure(listing.error)
      const lines = listing.entries.map((e) => `${e.isDirectory ? 'd' : '-'} ${e.name}`)
      if (listing.truncated) lines.push(`… ${listing.truncated} more`)
      const text = lines.join('\n') || '(空文件夹)'
      return { content: [{ type: 'text', text: cap(text) }], details: { display: text } }
    }
  })

  const request = defineTool({
    name: 'request',
    label: TOOL_LABELS.request,
    description:
      'Pause the turn and ask the user to approve an action or supply free-form input. Use before anything destructive or ambiguous.',
    parameters: Type.Object({
      instruction: Type.String({
        description: 'What you need the user to approve or provide.'
      })
    }),
    execute: (id, params) => park(host.ask(id, params.instruction)),
    executionMode: 'sequential'
  })

  const askQuestionItem = Type.Object({
    question: Type.String({ description: 'The question text.' }),
    choices: Type.Optional(Type.Array(Type.String())),
    multiSelect: Type.Optional(
      Type.Boolean({ description: 'When true with choices, allow selecting multiple.' })
    )
  })

  const askUserQuestion = defineTool({
    name: 'ask_user_question',
    label: TOOL_LABELS.ask_user_question,
    description:
      'Pause the turn and ask the user one or more questions. Supports single-choice, multi-choice, and free-text. Prefer `questions` for several prompts in one card.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Card title when asking several questions.' })),
      question: Type.Optional(Type.String({ description: 'Single-question form.' })),
      choices: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Optional preset answers for the single-question form.'
        })
      ),
      multiSelect: Type.Optional(Type.Boolean()),
      questions: Type.Optional(Type.Array(askQuestionItem))
    }),
    execute: async (id, params) => {
      const questions = normalizeAskQuestions(params as Record<string, unknown>)
      if (questions.length === 0) return failure('缺少 question / questions 参数')
      const summary =
        questions.length === 1
          ? questions[0].question
          : String((params as { title?: string }).title ?? `${questions.length} 个问题`)
      return park(
        host.ask(id, summary, {
          questions,
          askTitle: (params as { title?: string }).title,
          choices: questions.length === 1 ? questions[0].choices : undefined,
          multiSelect: questions.length === 1 ? questions[0].multiSelect : undefined
        })
      )
    },
    executionMode: 'sequential'
  })

  const plan = defineTool({
    name: 'plan',
    label: TOOL_LABELS.plan,
    description:
      'Create or update a visible plan checklist for the current turn. Call once to introduce steps (all pending), then again whenever a step changes status. Exactly one step may be executing at a time.',
    parameters: Type.Object({
      title: Type.String({ description: 'Short plan title shown in the card header.' }),
      steps: Type.Array(
        Type.Object({
          id: Type.String(),
          title: Type.String(),
          status: Type.Union([
            Type.Literal('pending'),
            Type.Literal('executing'),
            Type.Literal('done'),
            Type.Literal('error'),
            Type.Literal('skipped')
          ]),
          subtitle: Type.Optional(Type.String())
        }),
        { minItems: 1 }
      )
    }),
    async execute(_id, params) {
      const title = String(params.title ?? 'Plan').trim() || 'Plan'
      const steps = normalizePlanSteps(params.steps)
      const done = steps.filter((step) => step.status === 'done').length
      const summary = `Plan · ${title} (${done}/${steps.length})`
      return {
        content: [{ type: 'text', text: summary }],
        details: { display: summary }
      }
    }
  })

  return [
    terminal,
    wait,
    readBashSession,
    fsRead,
    fsWrite,
    fsList,
    request,
    askUserQuestion,
    plan
  ] as AgentTool[]
}

async function park(
  answer: Promise<{ text: string; cancelled: boolean }>
): Promise<{ content: [{ type: 'text'; text: string }]; details: ToolDetails }> {
  const result = await answer
  if (result.cancelled) {
    return {
      content: [{ type: 'text', text: 'The user cancelled the turn without answering.' }],
      details: { display: '本轮已取消，问题未回答', failed: true }
    }
  }
  return {
    content: [{ type: 'text', text: result.text }],
    details: { display: result.text }
  }
}

function failure(message: string): {
  content: [{ type: 'text'; text: string }]
  details: ToolDetails
} {
  return {
    content: [{ type: 'text', text: message }],
    details: { display: message, failed: true }
  }
}

/** Keeps head and tail so the model sees both the command echo and the result. */
function cap(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP) return text
  const half = Math.floor(TOOL_OUTPUT_CAP / 2)
  const omitted = text.length - TOOL_OUTPUT_CAP
  return `${text.slice(0, half)}\n\n…[${omitted} characters omitted]…\n\n${text.slice(-half)}`
}

const OS_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

export function buildSystemPrompt(workingDirectory: string, shell: string): string {
  return [
    `You are vav, a local coding agent running on the user's ${OS_NAMES[process.platform] ?? process.platform} machine.`,
    `The working directory for this conversation is: ${workingDirectory}`,
    // Without this the model reaches for POSIX idioms in a PowerShell session.
    `The user's shell is ${shell}; every \`terminal\` command must be valid ${shell} syntax.`,
    '',
    'You have real tools. Prefer acting over speculating:',
    '- `terminal` — wait mode (default) for commands that exit; fire-and-forget with `background: true` for servers/daemons (returns `{status,pid,sessionId}` immediately).',
    '- `wait` — block until a bash session prints `expect` (regex/literal), or timeout.',
    '- `read_bash_session` — poll the last N lines of bash scrollback without waiting.',
    '- `fs_read` / `fs_write` / `fs_list` operate on the local filesystem.',
    '- `request` and `ask_user_question` pause the turn to involve the user.',
    '- `plan` maintains a visible checklist for multi-step work; update it as steps progress.',
    '',
    'Guidelines:',
    '- Inspect before you edit: read the file, then write the complete new contents.',
    '- Ask via `request` before destructive or irreversible operations.',
    '- For several related questions, prefer one `ask_user_question` with a `questions` array.',
    '- Keep replies concise and in the language the user writes in.',
    '- Format code and command output as fenced markdown blocks.',
    '- There is no hard tool-iteration cap; stop when the task is done or ask the user.'
  ].join('\n')
}

/** Heuristic: commands that typically never exit on their own. */
function looksLikeServerCommand(command: string): boolean {
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

/** One-line label shown on the collapsed tool card. */
export function summarizeToolInput(tool: ToolName, input: Record<string, unknown>): string {
  switch (tool) {
    case 'terminal': {
      const cmd = truncate(String(input.command ?? ''), 100)
      return input.background ? `${cmd} (background)` : cmd
    }
    case 'wait':
      return truncate(`expect: ${String(input.expect ?? '')}`, 120)
    case 'read_bash_session':
      return `tailLines: ${String(input.tailLines ?? 200)}, sessionId: ${String(input.sessionId ?? BASH_SESSION_ID)}`
    case 'fs_read':
    case 'fs_write':
      return truncate(String(input.path ?? ''), 120)
    case 'fs_list':
      return truncate(String(input.path ?? '.'), 120)
    case 'request':
      return truncate(String(input.instruction ?? ''), 120)
    case 'ask_user_question': {
      const questions = normalizeAskQuestions(input)
      if (questions.length > 1) {
        return truncate(String(input.title ?? `${questions.length} 个问题`), 120)
      }
      return truncate(questions[0]?.question ?? String(input.question ?? ''), 120)
    }
    case 'plan': {
      const steps = normalizePlanSteps(input.steps)
      const done = steps.filter((step) => step.status === 'done').length
      return truncate(`Plan · ${String(input.title ?? 'Plan')} (${done}/${steps.length || 0})`, 120)
    }
    default:
      return ''
  }
}

function truncate(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}
