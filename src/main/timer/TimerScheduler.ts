import { VAV_DEFAULT_MODEL_ID, type Conversation } from '@shared/types'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import type { ConversationStore } from '../store/ConversationStore.ts'
import type { SettingsStore } from '../store/SettingsStore.ts'
import type { TimerStore } from '../store/TimerStore.ts'
import type { AgentRuntime } from '../agent/AgentRuntime.ts'
import { mintTimerWorkspace } from './timerWorkspace.ts'
import { ensureTimerOutput } from './timerOutput.ts'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'

export type TimerSchedulerHost = {
  timers: TimerStore
  conversations: ConversationStore
  settings: SettingsStore
  agent: AgentRuntime
  workspaceRoot: string
  accountIdFor?: (workdir: string | null) => string | null
  onSessionsChanged?: () => void
}

const TICK_MS = 5_000

/**
 * Fires due timer jobs on the host that owns AgentRuntime (vavd or
 * in-process desktop). Each fire mints a timestamped workspace and a
 * timer session — never a main-sidebar chat session.
 */
export class TimerScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private firing = new Set<string>()

  constructor(private readonly host: TimerSchedulerHost) {}

  start(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async runNow(jobId: string): Promise<{ sessionId: string } | null> {
    const job = this.host.timers.getJob(jobId)
    if (!job) return null
    return this.fire(job.id)
  }

  private tick(): void {
    const now = Date.now()
    for (const job of this.host.timers.dueJobs(now)) {
      void this.fire(job.id)
    }
  }

  private async fire(jobId: string): Promise<{ sessionId: string } | null> {
    if (this.firing.has(jobId) || this.host.timers.isJobRunning(jobId)) return null
    const job = this.host.timers.getJob(jobId)
    if (!job?.enabled || !job.prompt.trim()) return null
    this.firing.add(jobId)
    const at = Date.now()
    const workdir = mintTimerWorkspace(this.host.workspaceRoot, job.id, at)
    const snap = this.host.settings.get()
    const conversation = this.host.conversations.create(workdir, snap.defaultModel || VAV_DEFAULT_MODEL_ID, {
      title: job.title,
      timerJobId: job.id,
      timerRunAt: at,
      approvalMode: 'auto',
      thinkingLevel: parseThinkingLevel(snap.defaultThinkingLevel),
      machineId: LOCAL_MACHINE_ID,
      accountId: this.host.accountIdFor?.(workdir) ?? null
    })
    const run = this.host.timers.beginRun({
      jobId: job.id,
      sessionId: conversation.id,
      workdir,
      at
    })
    this.host.onSessionsChanged?.()
    try {
      await this.host.agent.run(conversation.id, job.prompt, [])
      const latest = this.host.conversations.get(conversation.id)
      const outputPath = latest
        ? ensureTimerOutput(workdir, latest.messages, latest.activeLeafId)
        : null
      this.host.timers.finishRun(run.id, 'done', outputPath)
      this.host.onSessionsChanged?.()
      return { sessionId: conversation.id }
    } catch (err) {
      console.error('[timers] run failed', err)
      const latest = this.host.conversations.get(conversation.id)
      const outputPath = latest
        ? ensureTimerOutput(workdir, latest.messages, latest.activeLeafId)
        : null
      this.host.timers.finishRun(run.id, 'error', outputPath)
      this.host.onSessionsChanged?.()
      return { sessionId: conversation.id }
    } finally {
      this.firing.delete(jobId)
    }
  }
}

export type { Conversation }
