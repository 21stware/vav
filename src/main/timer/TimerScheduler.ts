import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIMER_BRIEF_FILE, TIMER_OUTPUT_FILE, type TimerJob } from '@shared/timer'
import { threadPath } from '@shared/thread'
import type { ChatMessage, ToolCallBlock } from '@shared/types'
import type { ConversationStore } from '../store/ConversationStore'
import type { TimerStore } from '../store/TimerStore'
import { resolveTimerWorkdir } from './mintTimerWorkdir'

export type TimerSchedulerDeps = {
  store: TimerStore
  conversations: ConversationStore
  tmp: string | (() => string)
  defaultModel: () => string
  runTurn: (conversationId: string, text: string) => void
  isRunning: (conversationId: string) => boolean
  now?: () => number
  tickMs?: number
  /** Re-read jobs from disk so a sibling process (desktop ↔ vav-server) stays current. */
  reload?: () => void
  /** When true, skip firing — another host (usually vav-server) owns the clock. */
  shouldDefer?: () => boolean | Promise<boolean>
  /** Push the new run conversation to the desktop sidebar. */
  publish?: () => void
  /** Register the minted run workdir so fs_write / storage_write pass path allow. */
  watchWorkdir?: (conversationId: string, workdir: string) => void
}

const APP_OUTPUT_TOOLS = new Set([
  'note_write',
  'note_edit',
  'knowledge_write',
  'knowledge_library',
  'analysis_write',
  'analysis_edit',
  'schedule_write',
  'schedule_edit',
  'storage_write',
  'storage_edit',
  'app'
])

/** Last durable result of a scheduled run: an app URL, or a file the task actually wrote. */
export function timerRunDestination(messages: readonly ChatMessage[], leafId: string | null): string | null {
  let found: string | null = null
  for (const message of threadPath(messages, leafId)) {
    if (message.role !== 'assistant') continue
    for (const block of message.blocks) {
      if (block.kind !== 'toolCall' || block.status !== 'completed') continue
      const dest = destinationOf(block)
      if (dest) found = dest
    }
  }
  return found
}

function destinationOf(block: ToolCallBlock): string | null {
  const url = block.output.match(/vav:\/\/app\/\S+/)?.[0]
  if (url && APP_OUTPUT_TOOLS.has(block.tool)) return url
  if (block.tool !== 'fs_write') return null
  try {
    const input = JSON.parse(block.input) as { path?: unknown }
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    return path || null
  } catch {
    return null
  }
}

export function timerTurnPrompt(job: TimerJob): string {
  const connectors =
    job.connectorIds.length > 0
      ? `\nConnectors available for this run: ${job.connectorIds.join(', ')}. Prefer the connector tool for status/deploy.`
      : ''
  return [
    job.prompt.trim(),
    '',
    'This is a scheduled task. Do not ask the user questions. Do not wait for approval.',
    'Save the result where this task asks:',
    '- A note, 笔记, or write-up to keep → `note_write` (new) or `note_edit` (an existing note). Do not `fs_write` a markdown file for it.',
    '- An analysis dataset or live database → `analysis_write` or `analysis_edit`, then `sql_query`.',
    '- A scheduled task → `schedule_write` or `schedule_edit`.',
    '- A file for the Storage catalog → `storage_write` or `storage_edit`.',
    '- A workspace path the task names, or a report / slides / HTML / PDF / Office file → write that file. Mark a deliberate document as an artifact.',
    '- If the task names no destination, save the result as a Note with `note_write`.',
    `Do not create ${TIMER_OUTPUT_FILE} unless the task names that file.`,
    connectors
  ].join('\n')
}

export class TimerScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly inflight = new Map<string, string>()
  private readonly deps: TimerSchedulerDeps

  constructor(deps: TimerSchedulerDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.timer) return
    const ms = this.deps.tickMs ?? 15_000
    this.timer = setInterval(() => {
      void this.tick()
    }, ms)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(now = this.deps.now?.() ?? Date.now()): Promise<void> {
    this.deps.reload?.()
    if (await this.deps.shouldDefer?.()) return
    for (const job of this.deps.store.dueJobs(now)) {
      if (this.inflight.has(job.id)) continue
      if (!job.prompt.trim()) continue
      try {
        this.fire(job, now)
      } catch (err) {
        console.error('[timers] fire failed', job.id, err)
      }
    }
  }

  fire(job: TimerJob, now = this.deps.now?.() ?? Date.now()): { conversationId: string; runId: string } | null {
    if (!job.prompt.trim()) return null
    const tmp = typeof this.deps.tmp === 'function' ? this.deps.tmp() : this.deps.tmp
    const workdir = resolveTimerWorkdir(job, tmp, now)
    writeFileSync(
      join(workdir, TIMER_BRIEF_FILE),
      `# ${job.title}\n\n${job.prompt.trim()}\n`,
      'utf8'
    )
    const source = job.conversationId ? this.deps.conversations.get(job.conversationId) : undefined
    const pinned = Boolean(job.model?.trim())
    const model = job.model?.trim() || source?.model?.trim() || this.deps.defaultModel()
    const conversation = this.deps.conversations.create(workdir, model, {
      title: job.title,
      sessionKind: 'timer',
      timerJobId: job.id,
      timerRunAt: now,
      approvalMode: 'bypass',
      thinkingLevel: (pinned ? job.thinkingLevel : null) ?? source?.thinkingLevel,
      fast: pinned ? job.fast === true : source?.fast === true,
      cliHost: pinned ? job.cliHost : (source?.cliHost ?? null),
      accountId: pinned ? job.accountId : (source?.accountId ?? null)
    })
    const run = this.deps.store.beginRun({
      jobId: job.id,
      conversationId: conversation.id,
      workdir,
      now
    })
    if (!run) return null
    this.deps.conversations.updateMeta(conversation.id, { timerRunId: run.id })
    this.deps.watchWorkdir?.(conversation.id, workdir)
    this.inflight.set(job.id, conversation.id)
    this.deps.runTurn(conversation.id, timerTurnPrompt(job))
    this.deps.publish?.()
    return { conversationId: conversation.id, runId: run.id }
  }

  /** Call from the host turn:end handler. */
  onTurnEnd(conversationId: string, failed = false): void {
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation || conversation.sessionKind !== 'timer' || !conversation.timerRunId) return
    const run = this.deps.store.getRun(conversation.timerRunId)
    if (!run || run.status !== 'running') return
    const written = timerRunDestination(conversation.messages, conversation.activeLeafId)
    const outputFile = join(run.workdir, TIMER_OUTPUT_FILE)
    const outputPath = written ?? (existsSync(outputFile) ? outputFile : null)
    this.deps.store.finishRun(run.id, {
      status: failed ? 'failed' : 'done',
      outputPath,
      error: failed ? 'Turn ended with an error' : null
    })
    const jobId = conversation.timerJobId
    if (jobId) this.inflight.delete(jobId)
  }

  runNow(jobId: string): { conversationId: string; runId: string } | null {
    const job = this.deps.store.getJob(jobId)
    if (!job) return null
    if (this.inflight.has(job.id) || this.deps.store.listRuns(job.id).some((run) => run.status === 'running')) {
      return null
    }
    return this.fire(job)
  }
}
