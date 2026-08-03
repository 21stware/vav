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
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { Type, type TSchema } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
import {
  TOOL_LABELS,
  TOOL_OUTPUT_CAP,
  type AppSettings,
  type AskQuestion,
  type PreviewRef,
  type ToolName
} from '@shared/types'
import type { FileService } from '../fs/FileService'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'
import type { WebSearchService } from '../web/WebSearchService'
import type { WebFetchService } from '../web/WebFetchService'
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
  /** Record an fs_write for Change Review (before/after already captured). */
  recordWrite?: (filePath: string, originalContent: string | null, newContent: string) => void
  /** Local document RAG (PDF / office / text). */
  retrieval?: DocumentRetrievalService
  /** Public web search (local HTTP to search backends). */
  webSearch?: WebSearchService
  /** Public web fetch + readability extract. */
  webFetch?: WebFetchService
  /** Optional Brave Search API key (from SecretStore; never logged). */
  braveSearchKey?: () => string | null
  /** Selection from the user message that started this turn (for related search). */
  selectionAnchor?: () => PreviewRef[]
  /** File-session path when this conversation is bound to one document. */
  defaultDocPath?: () => string | null
}

export const INTERACTIVE_TOOLS: ReadonlySet<ToolName> = new Set(['request', 'ask_user_question'])
export const READONLY_TOOLS: ReadonlySet<ToolName> = new Set([
  'fs_read',
  'fs_list',
  'doc_search',
  'doc_fetch',
  'web_search',
  'web_fetch'
])
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
      'Read a UTF-8 text file by byte window (default first ~2MB). Pass start_byte / max_bytes to page further — large files are never refused. Relative paths resolve against the workdir. For PDF/DOCX/XLSX/PPTX use doc_search / doc_fetch instead.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
      start_byte: Type.Optional(
        Type.Number({ description: 'Byte offset to start reading (default 0).' })
      ),
      max_bytes: Type.Optional(
        Type.Number({
          description: 'Max bytes to return in this window (default ~2MB, hard max 16MB).'
        })
      )
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      const startByte =
        params.start_byte != null ? Math.max(0, Math.floor(Number(params.start_byte))) : 0
      const maxBytes =
        params.max_bytes != null ? Math.floor(Number(params.max_bytes)) : undefined
      const result = await host.files.readTextWindow(path, { startByte, maxBytes })
      if (result.error) {
        const hint =
          /\.(pdf|docx|xlsx|xls|pptx)$/i.test(String(params.path ?? '')) ||
          /binary/i.test(result.error)
            ? ' For office/PDF documents, use doc_search / doc_fetch.'
            : ''
        return failure(`${result.error}${hint}`)
      }
      const header = result.truncated
        ? `[bytes ${result.startByte}–${result.endByte} of ${result.totalBytes}; truncated — call again with start_byte=${result.endByte}]\n\n`
        : result.startByte > 0
          ? `[bytes ${result.startByte}–${result.endByte} of ${result.totalBytes}]\n\n`
          : ''
      const body = header + result.content
      return {
        content: [{ type: 'text', text: cap(body) }],
        details: { display: body }
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
      if (!previous.truncated) {
        host.recordWrite?.(path, before, params.content)
      }

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

  const docSearch = defineTool({
    name: 'doc_search',
    label: TOOL_LABELS.doc_search,
    description:
      'Search inside a PDF, Word, Excel, PowerPoint, or text document using local retrieval (BM25 + structure). Prefer this over fs_read for binary office/PDF files. Use related_to_selection=true to expand around the user\'s selected preview blocks.',
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: 'Keywords or natural-language query. Optional when related_to_selection is true.'
        })
      ),
      path: Type.Optional(
        Type.String({
          description:
            'Document path (absolute or workdir-relative). Defaults to the file-session document or the first selection path.'
        })
      ),
      top_k: Type.Optional(
        Type.Number({ description: 'How many chunks to return (default 8, max 20).' })
      ),
      related_to_selection: Type.Optional(
        Type.Boolean({
          description:
            'When true, rank by proximity/overlap with the user\'s selected context from this turn.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval) return failure('Document retrieval is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No document path. Pass path=… or open a file session / select content in the preview.'
        )
      }
      const query = String(params.query ?? '').trim()
      const related = params.related_to_selection === true
      if (!query && !related) {
        return failure('Provide query and/or related_to_selection=true')
      }
      const anchor = related ? buildSelectionAnchor(host) : undefined
      if (related && !anchor?.text && !(anchor?.blockIds?.length)) {
        // Still allow neighbor-less BM25 if query present
        if (!query) {
          return failure('related_to_selection=true but no selected context on this turn')
        }
      }
      const result = await host.retrieval.search({
        path,
        query: query || (anchor?.text ?? ''),
        topK: params.top_k != null ? Number(params.top_k) : undefined,
        anchor,
        mode: related ? 'related' : 'search'
      })
      if (result.error) return failure(result.error)
      if (result.hits.length === 0) {
        const warn = result.meta?.warnings?.join('; ')
        return {
          content: [
            {
              type: 'text',
              text: `No matching chunks in ${basename(path)}.${warn ? ` (${warn})` : ''}`
            }
          ],
          details: { display: `无匹配 · ${path}` }
        }
      }
      const modelLines = [
        `Found ${result.hits.length} chunk(s) in ${basename(path)}` +
          (result.meta ? ` · ${result.meta.chunkCount} indexed` : '') +
          (result.meta?.warnings?.length ? ` · ${result.meta.warnings.join('; ')}` : ''),
        ''
      ]
      const displayLines = [...modelLines]
      result.hits.forEach((hit, i) => {
        const loc =
          hit.chunk.page != null
            ? `Page ${hit.chunk.page}`
            : hit.chunk.sectionId ?? hit.chunk.kind
        const head = `${i + 1}. [doc:${hit.chunk.id} | ${basename(path)} | ${loc}] score=${hit.score} (${hit.reasons.join('+')})`
        modelLines.push(head)
        modelLines.push(`   ${hit.snippet}`)
        modelLines.push('')
        displayLines.push(head)
        displayLines.push(hit.chunk.text)
        displayLines.push('')
      })
      return {
        content: [{ type: 'text', text: cap(modelLines.join('\n')) }],
        details: { display: displayLines.join('\n') }
      }
    }
  })

  const docFetch = defineTool({
    name: 'doc_fetch',
    label: TOOL_LABELS.doc_fetch,
    description:
      'Fetch full text for document chunks by id (from doc_search), or all chunks on a page / section. Use after doc_search when you need the complete passage.',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: 'Document path; defaults like doc_search.'
        })
      ),
      ids: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Chunk or block ids returned by doc_search (max 20).'
        })
      ),
      page: Type.Optional(Type.Number({ description: '1-based PDF page to fetch.' })),
      section_id: Type.Optional(
        Type.String({ description: 'Structured section id (e.g. page-3, sheet name).' })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval) return failure('Document retrieval is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No document path. Pass path=… or open a file session / select content in the preview.'
        )
      }
      const ids = Array.isArray(params.ids) ? params.ids.map(String).slice(0, 20) : undefined
      const result = await host.retrieval.fetch({
        path,
        ids,
        page: params.page != null ? Number(params.page) : undefined,
        sectionId: params.section_id != null ? String(params.section_id) : undefined
      })
      if (result.error) return failure(result.error)
      if (result.chunks.length === 0) {
        return {
          content: [{ type: 'text', text: `No chunks matched in ${basename(path)}.` }],
          details: { display: `无块 · ${path}` }
        }
      }
      const lines: string[] = [
        `Fetched ${result.chunks.length} chunk(s) from ${basename(path)}`,
        ''
      ]
      for (const c of result.chunks) {
        const loc = c.page != null ? `Page ${c.page}` : c.sectionId ?? c.kind
        lines.push(`[doc:${c.id} | ${basename(path)} | ${loc}]`)
        lines.push(c.text)
        lines.push('')
      }
      const text = lines.join('\n')
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: text }
      }
    }
  })

  const webSearch = defineTool({
    name: 'web_search',
    label: TOOL_LABELS.web_search,
    description:
      'Search the public web from this machine (no vav cloud proxy). Returns ranked hits with title, url, and snippet. Prefer this over guessing URLs; then use web_fetch on the best results. Localhost / private IPs are blocked for general browsing — optional SearXNG base URL in settings is the exception for search only.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query (keywords or natural language).' }),
      num_results: Type.Optional(
        Type.Number({ description: 'How many results to return (default 8, max 12).' })
      ),
      site: Type.Optional(
        Type.String({
          description: 'Optional host to restrict results (site: filter), e.g. "developer.mozilla.org".'
        })
      )
    }),
    async execute(_id, params, signal) {
      if (!host.webSearch) return failure('Web search is unavailable')
      const query = String(params.query ?? '').trim()
      if (!query) return failure('Missing query')
      const settings = host.settings()
      const result = await host.webSearch.search({
        query,
        numResults: params.num_results != null ? Number(params.num_results) : undefined,
        site: params.site != null ? String(params.site) : undefined,
        timeoutMs: settings.webTimeoutMs,
        searxngBaseUrl: settings.webSearxngBaseUrl || undefined,
        braveApiKey: host.braveSearchKey?.() || undefined,
        provider: settings.webSearchProvider,
        signal
      })
      if (!result.ok) {
        return failure(host.webSearch.formatForModel(result))
      }
      const text = host.webSearch.formatForModel(result)
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: host.webSearch.formatForDisplay(result) }
      }
    }
  })

  const webFetch = defineTool({
    name: 'web_fetch',
    label: TOOL_LABELS.web_fetch,
    description:
      'Fetch a public http(s) URL and return readable text (HTML → main article markdown when possible). Use after web_search or when the user gives a URL. Blocks private/localhost addresses. Prefer this over terminal curl for reading pages.',
    parameters: Type.Object({
      url: Type.String({ description: 'Absolute http(s) URL to fetch.' }),
      extract: Type.Optional(
        Type.String({
          description:
            'auto (default: HTML→markdown via Readability), markdown, text, or raw (no extract).'
        })
      ),
      max_chars: Type.Optional(
        Type.Number({
          description: 'Max characters of body returned (default 12000, hard max 40000).'
        })
      ),
      start_line: Type.Optional(
        Type.Number({ description: '1-based line offset into the extracted body for long pages.' })
      )
    }),
    async execute(_id, params, signal) {
      if (!host.webFetch) return failure('Web fetch is unavailable')
      const url = String(params.url ?? '').trim()
      if (!url) return failure('Missing url')
      const extractRaw = params.extract != null ? String(params.extract) : 'auto'
      const extract =
        extractRaw === 'markdown' ||
        extractRaw === 'text' ||
        extractRaw === 'raw' ||
        extractRaw === 'auto'
          ? extractRaw
          : 'auto'
      const settings = host.settings()
      const result = await host.webFetch.fetch({
        url,
        extract,
        maxChars: params.max_chars != null ? Number(params.max_chars) : undefined,
        startLine: params.start_line != null ? Number(params.start_line) : undefined,
        timeoutMs: settings.webTimeoutMs,
        allowRender: settings.webFetchAllowRender,
        signal
      })
      const text = host.webFetch.formatForModel(result)
      if (!result.ok) {
        return failure(text)
      }
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: { display: text }
      }
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

  // Hard cap: long choice lists feel like a survey. Other is always available in UI.
  const ASK_CHOICES_MAX = 4
  const askChoices = Type.Optional(
    Type.Array(Type.String(), {
      maxItems: ASK_CHOICES_MAX,
      description: `2–${ASK_CHOICES_MAX} short preset answers only. The UI always adds Other — do not invent filler options.`
    })
  )

  const askQuestionItem = Type.Object({
    question: Type.String({ description: 'The question text.' }),
    choices: askChoices,
    multiSelect: Type.Optional(
      Type.Boolean({
        description: 'When true with choices, the user may select multiple options (checkboxes).'
      })
    )
  })

  const askUserQuestion = defineTool({
    name: 'ask_user_question',
    label: TOOL_LABELS.ask_user_question,
    description:
      'Pause the turn and ask the user one or more questions (vav tool, not a pi built-in). Prefer 1–3 questions. For each question give 2–4 short choices max (single- or multi-select); the UI always offers Other — never pad with joke/filler options. Free-text only when choices do not apply. Prefer one `questions` array for related prompts.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Card title when asking several questions.' })),
      question: Type.Optional(Type.String({ description: 'Single-question form.' })),
      choices: askChoices,
      multiSelect: Type.Optional(
        Type.Boolean({ description: 'When true with choices, allow selecting multiple options.' })
      ),
      questions: Type.Optional(
        Type.Array(askQuestionItem, {
          maxItems: 5,
          description: 'Related questions (max 5). One question per step in the UI.'
        })
      )
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
    description: [
      'Create or update the visible multi-step checklist for this turn.',
      'Call once at the start with all steps pending (or one executing).',
      'Call again whenever a step changes: mark finished work done, set exactly one step executing while you work on it.',
      'Before your final user-facing answer — when the overall task is complete — call plan one last time with every completed step status "done".',
      'Do not stop the turn while steps you finished are still pending; the UI only updates when you call this tool.',
      'If you abandon remaining work, mark those steps "skipped" (or "error") instead of leaving them pending.',
      'Exactly one step may be "executing" at a time.'
    ].join(' '),
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
      const open = steps.filter(
        (step) => step.status === 'pending' || step.status === 'executing'
      ).length
      const summary = `Plan · ${title} (${done}/${steps.length})`
      // Reminder stays in model-facing content so the next step of the loop
      // still sees incomplete checklist items after a partial update.
      const reminder =
        open > 0
          ? `\n${open} step(s) still open. Before your final answer, call plan again so finished work is "done" (or "skipped" if abandoned).`
          : '\nAll steps closed.'
      return {
        content: [{ type: 'text', text: summary + reminder }],
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
    docSearch,
    docFetch,
    webSearch,
    webFetch,
    request,
    askUserQuestion,
    plan
  ] as AgentTool[]
}

function resolveDocPath(host: ToolHost, raw: unknown): string | null {
  const explicit = typeof raw === 'string' ? raw.trim() : ''
  if (explicit) {
    return isAbsolute(explicit) ? explicit : resolvePath(host.workdir, explicit)
  }
  const fromDefault = host.defaultDocPath?.()?.trim()
  if (fromDefault) return fromDefault
  const refs = host.selectionAnchor?.() ?? []
  const fromSel = refs.find((r) => r.filePath)?.filePath
  return fromSel?.trim() || null
}

function buildSelectionAnchor(
  host: ToolHost
): { text?: string; blockIds?: string[]; chunkIds?: string[] } | undefined {
  const refs = host.selectionAnchor?.() ?? []
  if (refs.length === 0) return undefined
  const texts: string[] = []
  const blockIds: string[] = []
  for (const ref of refs) {
    if (ref.text?.trim()) texts.push(ref.text.trim())
    // PreviewRef.id is typically `${path}::${blockId}`
    const sep = ref.id.lastIndexOf('::')
    if (sep >= 0) blockIds.push(ref.id.slice(sep + 2))
    else if (ref.id) blockIds.push(ref.id)
  }
  return {
    text: texts.join('\n\n').slice(0, 4000),
    blockIds: blockIds.length ? blockIds : undefined,
    chunkIds: blockIds.length ? blockIds : undefined
  }
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

export function buildSystemPrompt(
  workingDirectory: string,
  shell: string,
  options?: {
    fileReadOnly?: boolean
    openFilePath?: string | null
    openFileKind?: string | null
  }
): string {
  const openFile = options?.openFilePath?.trim() || null
  const openKind = options?.openFileKind?.trim() || null
  const lines = [
    `You are vav, a local coding agent running on the user's ${OS_NAMES[process.platform] ?? process.platform} machine.`,
    `The working directory for this conversation is: ${workingDirectory}`,
    // Without this the model reaches for POSIX idioms in a PowerShell session.
    `The user's shell is ${shell}; every \`terminal\` command must be valid ${shell} syntax.`,
    ''
  ]
  if (openFile) {
    lines.push(
      `The user is viewing this file in the preview: ${openFile}`,
      'That file is the primary document for this session. Prefer it for doc_search / doc_fetch / analysis.',
      'Do not open or search other documents in the folder unless the user explicitly asks for them.',
      'When calling doc_search or doc_fetch, pass path to that file (or omit path so the default open file is used).',
      ''
    )
    if (openKind === 'zip') {
      lines.push(
        'This is a ZIP archive. The file tree is available — you may reference entries by path. Individual file contents are not extracted for preview.',
        ''
      )
    } else if (openKind === 'binary') {
      lines.push(
        'This file type (application/octet-stream) cannot be parsed for content. Only file metadata is available.',
        ''
      )
    }
  }
  lines.push(
    'You have real tools. Prefer acting over speculating:',
    '- `terminal` — wait mode (default) for commands that exit; fire-and-forget with `background: true` for servers/daemons (returns `{status,pid,sessionId}` immediately).',
    '- `wait` — block until a bash session prints `expect` (regex/literal), or timeout.',
    '- `read_bash_session` — poll the last N lines of bash scrollback without waiting.',
    options?.fileReadOnly
      ? '- `fs_read` / `fs_list` operate on the local filesystem. `fs_write` is unavailable.'
      : '- `fs_read` / `fs_write` / `fs_list` operate on the local filesystem.',
    '- `doc_search` / `doc_fetch` — local retrieval over PDF, Word, Excel, PowerPoint, CSV/TSV, and text. Prefer these over terminal/python for office/PDF content. Do not install python-docx/pdf tools when doc_search can read the file.',
    '- `web_search` / `web_fetch` — public web from this machine (Brave if key configured, else optional SearXNG, else DuckDuckGo HTML). Search first, then fetch promising URLs. HTML/PDF/text/JSON supported; private/localhost URLs are blocked. Prefer these over `terminal` curl/wget for reading pages.',
    '- `request` and `ask_user_question` pause the turn to involve the user (vav tools).',
    '- `plan` — visible checklist for multi-step work. The UI only updates when you call it; finishing tools alone does not check steps off.',
    '',
    'File-preview edit loop (product model):',
    '1) View — user sees a format-correct canvas (windowed/streamed; never refuse on size).',
    '2) Block select — user picks structural blocks, not a free-form code editor.',
    '3) Dialogue — selected blocks + notes are anchors; gather evidence with tools.',
    '4) Agent edit — you propose/apply changes; the user does not hand-edit bytes as the primary path.',
    '5) Save — user reviews (Change Review) then accepts or discards.',
    options?.fileReadOnly
      ? '- This session is read-only: analyze only; do not write the file.'
      : '- For text files: inspect with windowed `fs_read`, then `fs_write` the complete new contents when editing.',
    '- For PDF/Office binary: prefer `doc_search` / `doc_fetch`; do not UTF-8-overwrite OOXML/PDF.',
    '- Selected context in the user message is only an anchor; call `doc_search` when you need more evidence from the same document.',
    '- Cite retrieved passages with their `[doc:…]` ids; cite web sources by url or `[web:N]`.',
    '- Ask via `request` before destructive or irreversible operations.',
    '- `ask_user_question`: keep it short — few questions, 2–4 real choices each (UI adds Other). No long option menus or joke fillers.',
    '- For several related questions, prefer one `ask_user_question` with a `questions` array.',
    // Plan lifecycle — models often finish the work then reply without a last plan call.
    '- When you open a `plan`, keep it truthful: after each meaningful step call `plan` again (done / executing).',
    '- Before your final reply on a planned task, call `plan` once more so every completed step is `done`. Mark leftover work `skipped` or `error` — do not leave finished work as `pending`.',
    '- Keep replies concise and in the language the user writes in.',
    '- Format code and command output as fenced markdown blocks.',
    '- There is no hard tool-iteration cap; stop when the task is done or ask the user.'
  )
  return lines.join('\n')
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
    case 'doc_search': {
      const q = String(input.query ?? '')
      const related = input.related_to_selection ? ' · related' : ''
      return truncate(`${String(input.path ?? '')} ${q}${related}`.trim(), 120)
    }
    case 'doc_fetch':
      return truncate(
        `${String(input.path ?? '')} ids=${JSON.stringify(input.ids ?? [])} page=${String(input.page ?? '')}`,
        120
      )
    case 'web_search': {
      const site = input.site ? ` site:${String(input.site)}` : ''
      return truncate(`${String(input.query ?? '')}${site}`.trim(), 120)
    }
    case 'web_fetch':
      return truncate(String(input.url ?? ''), 120)
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
