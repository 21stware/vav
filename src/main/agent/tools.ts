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
import { basename, dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path'
import { Type, type TSchema } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
import {
  TOOL_LABELS,
  type AppSettings,
  type AskQuestion,
  type PreviewRef,
  type ToolName
} from '@shared/types'
import type { FileService } from '../fs/FileService'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'
import { type DuckDbService, duckDbKindForPath } from '../fs/DuckDbService'
import type { WebSearchService } from '../web/WebSearchService'
import type { WebFetchService } from '../web/WebFetchService'
import { BASH_SESSION_ID, type StickyShell } from '../terminal/StickyShell'
import { t } from '../i18n'
import type { SkillService } from './SkillService'
import { unifiedDiff } from './diff'
import { cap, looksLikeServerCommand } from './toolSummarize'

export { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
export { summarizeToolInput } from './toolSummarize'
export { buildSystemPrompt } from './systemPrompt'

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
  /** Routes fs/shell I/O to the conversation's workspace host. */
  conversationId: string
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
  /** Analytical SQL over SQLite / CSV / TSV / Parquet via DuckDB. */
  duckdb?: DuckDbService
  /** Public web search (local HTTP to search backends). */
  webSearch?: WebSearchService
  /** Public web fetch + readability extract. */
  webFetch?: WebFetchService
  /** Bundled / remote Agent Skills (SKILL.md packages). */
  skills?: SkillService
  /** Optional Brave Search API key (from SecretStore; never logged). */
  braveSearchKey?: () => string | null
  /** Optional TinyFish API key (from SecretStore; never logged). */
  tinyfishSearchKey?: () => string | null
  /** Selection from the user message that started this turn (for related search). */
  selectionAnchor?: () => PreviewRef[]
  /** File-session path when this conversation is bound to one document. */
  defaultDocPath?: () => string | null
  /** File-preview session is currently Read (write tools gated). */
  isFileReadOnly?: () => boolean
  /**
   * Flip file-preview Read/Edit. Returns an error string when the format cannot
   * enter Edit in-place (PDF / HEIC / legacy Office / …).
   */
  setFileReadOnly?: (readOnly: boolean) => string | null
}

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

export {
  FILE_READONLY_BLOCKED_TOOLS,
  isFileEditLockedPath,
  isReadonlyTerminalCommand
} from './fileEditLock'

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
    async execute(_id, params, signal) {
      let command = params.command.trim()
      if (!command) return failure('缺少 command 参数')
      // Force officecli/shell writes onto document sandboxes when the model
      // still uses the user's original absolute path.
      if (host.files.workingCopies) {
        command = host.files.workingCopies.rewriteCommand(command)
      }

      const timeout = host.settings().commandTimeout
      const background = params.background === true || looksLikeServerCommand(command)
      const shell = host.shell()
      host.mirror(`$ ${command}${background ? '  # background' : ''}\n`)
      const result = background
        ? await shell.runBackground(command, (chunk) => host.mirror(chunk), signal)
        : await shell.run(command, timeout, (chunk) => host.mirror(chunk), signal)

      if (result.cancelled) {
        host.mirror(`\n${t('common.cancelled')}\n`)
        const body = result.output
        return {
          content: [{ type: 'text', text: cap(`${body}\n[${t('common.cancelled')}]`) }],
          details: {
            display: `${body}${body && !body.endsWith('\n') ? '\n' : ''}${t('tool.cancelled')}`,
            failed: true
          }
        }
      }
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
      // officecli writes the sandbox path; mark dirtied copies for preview refresh.
      if (host.files.workingCopies) {
        void host.files.workingCopies.scanDirtiedCopies().then((paths) => {
          for (const p of paths) {
            host.fsChanged(dirname(p), p)
          }
        })
      }
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
    async execute(_id, params, signal) {
      const sessionId = String(params.sessionId ?? BASH_SESSION_ID)
      const shell = host.shell()
      if (sessionId !== shell.sessionId) {
        return failure(`未知 sessionId「${sessionId}」（当前仅支持 ${shell.sessionId}）`)
      }
      const expect = String(params.expect ?? '').trim()
      if (!expect) return failure('缺少 expect 参数')
      const timeoutMs = Number(params.timeoutMs ?? 60_000)
      const result = await shell.waitFor(expect, timeoutMs, signal)
      const seconds = (result.elapsedMs / 1000).toFixed(1)
      if (result.cancelled) {
        return {
          content: [
            {
              type: 'text',
              text: cap(
                JSON.stringify({
                  matched: false,
                  cancelled: true,
                  output_since_start: result.output,
                  elapsedMs: result.elapsedMs
                })
              )
            }
          ],
          details: {
            display: `${t('tool.cancelled')}\n${result.output}`,
            failed: true
          }
        }
      }
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
      'Read a UTF-8 text file by byte window (default first ~2MB). Pass start_byte / max_bytes to page further — large files are never refused. Relative paths resolve against the workdir. For PDF/DOCX/XLSX/PPTX/CSV prefer doc_search / doc_fetch (or sql_query for CSV/TSV/Parquet/SQLite analysis). Images, audio, video, and other binaries are not readable as text.',
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
      const result = await host.files.readTextWindow(path, {
        startByte,
        maxBytes,
        conversationId: host.conversationId
      })
      if (result.error) {
        const hint = /\.(pdf|docx|xlsx|xls|pptx)$/i.test(String(params.path ?? ''))
          ? ' For office/PDF documents, use doc_search / doc_fetch.'
          : /\.(csv|tsv)$/i.test(String(params.path ?? ''))
            ? ' For CSV/TSV analysis prefer sql_query; doc_search also works.'
            : /\.(png|jpe?g|gif|webp|bmp|svg|heic|mp3|mp4|mov|wav|webm|mkv)$/i.test(
                  String(params.path ?? '')
                ) || /binary/i.test(result.error)
              ? ' Images/audio/video and other binaries cannot be read as UTF-8 text.'
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
      'Create or overwrite a UTF-8 text file, creating parent directories as needed. Relative paths resolve against the conversation working directory. Do not use for .docx/.xlsx/.pptx/.pdf (would corrupt them) — use officecli or the pdf skill instead.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, absolute or relative to the workdir.' }),
      content: Type.String({ description: 'Full file contents to write.' })
    }),
    async execute(_id, params) {
      const path = inWorkdir(params.path)
      // What changed only exists before the write lands, so capture it first.
      const previous = await host.files.readTextFile(path, host.conversationId)
      const before = previous.error || previous.truncated ? null : previous.content

      const result = await host.files.writeTextFile(path, params.content, host.conversationId)
      if (!result.ok) return failure(result.error ?? '写入失败')
      // Only the parent directory is refreshed; never the whole tree.
      const logical = host.files.workingCopies?.logicalPath(path) ?? path
      host.fsChanged(dirname(logical), logical)
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
      const listing = await host.files.listDirectory(
        inWorkdir(params.path ?? '.'),
        'name',
        true,
        host.conversationId
      )
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
      'Search inside a PDF, Word, Excel, PowerPoint, CSV/TSV, or text document using local retrieval (BM25 + structure). Prefer this over fs_read for binary office/PDF files. PDF indexing uses the extractable text layer only (no OCR). Not for images/audio/video. Use related_to_selection=true to expand around the user\'s selected preview blocks.',
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

  const sqlQuery = defineTool({
    name: 'sql_query',
    label: TOOL_LABELS.sql_query,
    description:
      'Run read-only analytical SQL (DuckDB dialect) over a SQLite, CSV, TSV, or Parquet file (not .xlsx/.xls). The file is attached in-memory; tables from a SQLite DB or a single CSV/TSV/Parquet file are queryable by name. Use this for analysis (aggregation, GROUP BY, JOIN, window functions) instead of paging the DB preview. Run `SHOW TABLES` first to list available tables, or `DESCRIBE <table>` for columns. For Excel workbooks use doc_search or officecli/xlsx instead.',
    parameters: Type.Object({
      sql: Type.String({
        description:
          'DuckDB SQL statement. SELECT / SHOW / DESCRIBE / WITH / EXPLAIN are expected. DDL that mutates the source file is not possible (in-memory attach).'
      }),
      path: Type.Optional(
        Type.String({
          description:
            'File path (.db/.sqlite/.sqlite3/.db3/.csv/.tsv/.parquet), absolute or workdir-relative. Defaults to the file-session document.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.duckdb) return failure('DuckDB is unavailable')
      const path = resolveDocPath(host, params.path)
      if (!path) {
        return failure(
          'No file path. Pass path=… or open a file session for a SQLite/CSV/TSV/Parquet file.'
        )
      }
      const sql = String(params.sql ?? '').trim()
      if (!sql) return failure('Missing sql parameter')

      const kind = duckDbKindForPath(path)
      if (!kind) {
        return failure(
          `Unsupported file type for sql_query: ${extname(path) || basename(path)}. Use .db/.sqlite/.csv/.tsv/.parquet.`
        )
      }

      const lower = sql.toLowerCase()
      const isSchema =
        lower.startsWith('show ') ||
        lower.startsWith('describe ') ||
        lower.startsWith('pragma ') ||
        lower === 'show tables'

      const result = await host.duckdb.query(path, sql)
      if (result.error) {
        return {
          content: [{ type: 'text', text: `SQL error: ${result.error}` }],
          details: { display: `✗ ${basename(path)} · ${result.error}` }
        }
      }

      const header = result.columns.join(' | ')
      const sep = result.columns.map(() => '---').join(' | ')
      const dataRows = result.rows.map((r) => r.join(' | '))
      const modelLines = [
        `${basename(path)} (${kind}) · ${result.rowCount} row(s)${
          result.truncated ? ` (truncated to ${result.rows.length})` : ''
        }`,
        header,
        sep,
        ...dataRows
      ]
      const displayLines = [
        `${basename(path)} (${kind}) · ${result.rowCount} row(s)${
          result.truncated ? ` (truncated to ${result.rows.length})` : ''
        }`,
        header,
        ...result.rows.map((r) => r.join(' | '))
      ]
      const text = cap(modelLines.join('\n'))
      const summary = isSchema
        ? `schema · ${basename(path)}`
        : `${result.rowCount} row(s) · ${basename(path)}`
      return {
        content: [{ type: 'text', text }],
        details: { display: displayLines.join('\n'), summary }
      }
    }
  })

  const webSearch = defineTool({
    name: 'web_search',
    label: TOOL_LABELS.web_search,
    description:
      'Search the public web from this machine (no VAV cloud proxy). Returns ranked hits with title, url, and snippet. Prefer this over guessing URLs; then use web_fetch on the best results. Localhost / private IPs are blocked for general browsing — optional SearXNG base URL in settings is the exception for search only.',
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
        tinyfishApiKey: host.tinyfishSearchKey?.() || undefined,
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
        tinyfishApiKey: host.tinyfishSearchKey?.() || undefined,
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
      'Pause the turn and ask the user one or more questions (VAV tool, not a pi built-in). Prefer 1–3 questions. For each question give 2–4 short choices max (single- or multi-select); the UI always offers Other — never pad with joke/filler options. Free-text only when choices do not apply. Prefer one `questions` array for related prompts.',
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

  const loadSkill = defineTool({
    name: 'load_skill',
    label: TOOL_LABELS.load_skill,
    description: [
      'Load a specialized Agent Skill (instructions, workflows, and optional scripts) to improve quality on a domain task.',
      'Call this BEFORE generating or heavily editing: Markdown/docs, PPTX, XLSX, DOCX, PDF, web UI, dashboards, charts, image/shader work, or multi-file app structure.',
      'Omit name (or pass list:true) to list the catalog. Pass name to load SKILL.md. Pass path for a companion file under that skill (e.g. references/editing.md).',
      'Optional url= fetches a remote SKILL.md from allowlisted hosts (raw.githubusercontent.com / github.com) when the user provides a skill URL — prefer bundled skills.'
    ].join(' '),
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description:
            'Skill id (preferred) or name, e.g. "officecli", "pptx", "xlsx", "docx", "pdf", "frontend-design", "doc-coauthoring".'
        })
      ),
      path: Type.Optional(
        Type.String({
          description:
            'Optional relative path inside the skill folder after loading the main skill (e.g. "references/design-system.md").'
        })
      ),
      list: Type.Optional(
        Type.Boolean({
          description: 'When true (or when name is omitted), return the skill catalog only.'
        })
      ),
      url: Type.Optional(
        Type.String({
          description:
            'Optional remote https URL to a SKILL.md (GitHub raw or blob). Allowlisted hosts only.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.skills) return failure('Skill service is unavailable')
      const listOnly = params.list === true || (!params.name && !params.url)
      if (listOnly) {
        const cat = host.skills.catalog()
        const lines = [
          cat.note ? `Note: ${cat.note}` : '',
          `Available skills (${cat.skills.length}):`,
          ...cat.skills.map((s) => {
            const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : ''
            return `- ${s.id}${tags} (${s.license}): ${s.description}`
          }),
          '',
          'Load one with load_skill({ name: "<id>" }). Load a companion with path: "references/…".'
        ].filter(Boolean)
        const text = lines.join('\n')
        return {
          content: [{ type: 'text', text: cap(text) }],
          details: { display: text, summary: `${cat.skills.length} skills` }
        }
      }

      if (params.url) {
        const remote = await host.skills.loadRemote(String(params.url))
        if ('error' in remote) return failure(remote.error)
        const text = remote.content
        return {
          content: [{ type: 'text', text: cap(text) }],
          details: {
            display: text,
            summary: `remote · ${remote.id}${remote.truncated ? ' · truncated' : ''}`
          }
        }
      }

      const name = String(params.name ?? '').trim()
      if (!name) return failure('Missing name (or set list:true)')
      const loaded = host.skills.loadLocal(
        name,
        params.path != null ? String(params.path) : null,
        host.workdir
      )
      if ('error' in loaded) return failure(loaded.error)
      const footer =
        loaded.companionFiles.length > 0
          ? `\n\n## Companion files (load with path=)\n${loaded.companionFiles
              .slice(0, 60)
              .map((f) => `- ${f}`)
              .join('\n')}${loaded.companionFiles.length > 60 ? `\n…+${loaded.companionFiles.length - 60} more` : ''}`
          : ''
      const text = loaded.content + footer
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: {
          display: text,
          summary: `${loaded.id}/${loaded.path}${loaded.truncated ? ' · truncated' : ''}`
        }
      }
    }
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

  const switchMode = defineTool({
    name: 'switch_mode',
    label: TOOL_LABELS.switch_mode,
    description: [
      'Switch the file-preview session from Read to Edit so write tools (`fs_write`, mutating shell) can run.',
      'Only available while the session is Read. Under Auto approval the user must Approve; Bypass runs immediately.',
      'Call this before attempting file edits when the session is Read. After success, proceed with writes in the same turn.',
      'If the format cannot edit in-place (PDF / HEIC / legacy Office / ZIP), tell the user to convert or Save As instead.'
    ].join(' '),
    parameters: Type.Object({
      mode: Type.Literal('edit'),
      reason: Type.Optional(
        Type.String({
          description: 'Short reason shown on the approval card (what you need to change).'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.setFileReadOnly) {
        return failure('Switch mode is unavailable in this session.')
      }
      if (!host.isFileReadOnly?.()) {
        return {
          content: [{ type: 'text', text: 'Already in Edit mode. Write tools are available.' }],
          details: { display: '已是 Edit 模式' }
        }
      }
      if (params.mode !== 'edit') {
        return failure('Only mode "edit" is supported.')
      }
      const err = host.setFileReadOnly(false)
      if (err) return failure(err)
      const note = typeof params.reason === 'string' ? params.reason.trim() : ''
      const text = note
        ? `Switched to Edit mode (${note}). You may now use fs_write and mutating shell commands.`
        : 'Switched to Edit mode. You may now use fs_write and mutating shell commands.'
      return {
        content: [{ type: 'text', text }],
        details: { display: note ? `切换到 Edit · ${note}` : '切换到 Edit' }
      }
    }
  })

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

