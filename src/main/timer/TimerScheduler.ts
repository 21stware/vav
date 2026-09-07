import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIMER_BRIEF_FILE, TIMER_OUTPUT_FILE, type TimerJob } from '@shared/timer'
import { textOf } from '../agent/agentMessage'
import { threadPath } from '@shared/thread'
import type { ConversationStore } from '../store/ConversationStore'
import type { TimerStore } from '../store/TimerStore'
import { mintTimerWorkdir } from './mintTimerWorkdir'

export type TimerSchedulerDeps = {
  store: TimerStore
  conversations: ConversationStore
  tmp: string
  defaultModel: () => string
  runTurn: (conversationId: string, text: string) => void
  isRunning: (conversationId: string) => boolean
  now?: () => number
  tickMs?: number
  /** Re-read jobs from disk so a sibling process (desktop ↔ vavd) stays current. */
  reload?: () => void
  /** When true, skip firing — another host (usually vavd) owns the clock. */
  shouldDefer?: () => boolean | Promise<boolean>
  /** Push the new run conversation to the desktop sidebar. */
  publish?: () => void
}

function lastAssistantText(store: ConversationStore, conversationId: string): string {
  const conversation = store.get(conversationId)
  if (!conversation) return ''
  const path = threadPath(conversation.messages, conversation.activeLeafId)
  for (let i = path.length - 1; i >= 0; i--) {
    const message = path[i]!
    if (message.role !== 'assistant') continue
    const text = (message.content || textOf(message.blocks) || '').trim()
    if (text) return text
  }
  return ''
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
    `When finished, write a Markdown report to ${TIMER_OUTPUT_FILE} in the working directory (title, what you did, result, any URLs).`,
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
    const workdir =
      job.workdirPolicy === 'source' && job.sourceWorkdir && existsSync(job.sourceWorkdir)
        ? job.sourceWorkdir
        : mintTimerWorkdir(this.deps.tmp, job.id, now)
    writeFileSync(
      join(workdir, TIMER_BRIEF_FILE),
      `# ${job.title}\n\n${job.prompt.trim()}\n`,
      'utf8'
    )
    const conversation = this.deps.conversations.create(workdir, this.deps.defaultModel(), {
      title: job.title,
      sessionKind: 'timer',
      timerJobId: job.id,
      timerRunAt: now,
      approvalMode: 'bypass'
    })
    const run = this.deps.store.beginRun({
      jobId: job.id,
      conversationId: conversation.id,
      workdir,
      now
    })
    if (!run) return null
    this.deps.conversations.updateMeta(conversation.id, { timerRunId: run.id })
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
    const outputPath = join(run.workdir, TIMER_OUTPUT_FILE)
    if (!existsSync(outputPath)) {
      const body = lastAssistantText(this.deps.conversations, conversationId)
      writeFileSync(
        outputPath,
        `# ${conversation.title}\n\n${body || '_No assistant output._'}\n`,
        'utf8'
      )
    }
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
