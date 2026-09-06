import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationStore } from './ConversationStore.ts'
import { electronUserData } from './electronUserData.ts'
import {
  nextTimerDue,
  timerJobDraft,
  type TimerJob,
  type TimerRun,
  type TimerRunStatus,
  type TimerSessionListEntry
} from '../../shared/timer.ts'

interface IndexFile {
  version: 1
  jobs: Record<string, TimerJob>
  runs: Record<string, TimerRun>
}

function emptyIndex(): IndexFile {
  return { version: 1, jobs: {}, runs: {} }
}

/**
 * Scheduled jobs + the timer sessions they mint.
 * Sessions live in ConversationStore with timerJobId set (hidden from the
 * main sidebar, listed next to file sessions).
 */
export class TimerStore {
  private readonly dir: string
  private readonly indexPath: string
  private index: IndexFile = emptyIndex()
  private conversations: ConversationStore | null = null

  constructor(stateDir?: string) {
    this.dir = join(stateDir ?? electronUserData(), 'timers')
    this.indexPath = join(this.dir, 'index.json')
  }

  bind(conversations: ConversationStore): void {
    this.conversations = conversations
    this.load()
  }

  private load(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      if (!existsSync(this.indexPath)) return
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as IndexFile
      if (raw?.version === 1 && raw.jobs && raw.runs) this.index = raw
    } catch (err) {
      console.error('[timers] index load failed', err)
      this.index = emptyIndex()
    }
  }

  private flush(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${this.indexPath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.index, null, 2), 'utf8')
      renameSync(tmp, this.indexPath)
    } catch (err) {
      console.error('[timers] index write failed', err)
    }
  }

  listJobs(): TimerJob[] {
    return Object.values(this.index.jobs).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getJob(id: string): TimerJob | undefined {
    return this.index.jobs[id]
  }

  upsertJob(input: {
    id?: string
    title: string
    prompt: string
    everyMinutes?: number
    at?: number
    enabled?: boolean
  }): TimerJob {
    const now = Date.now()
    const existing = input.id ? this.index.jobs[input.id] : undefined
    const draft = timerJobDraft({
      title: input.title,
      prompt: input.prompt,
      everyMinutes: input.everyMinutes,
      at: input.at,
      now
    })
    const job: TimerJob = existing
      ? {
          ...existing,
          title: draft.title,
          prompt: draft.prompt,
          schedule: draft.schedule,
          enabled: input.enabled ?? existing.enabled,
          updatedAt: now,
          nextRunAt: nextTimerDue(
            { schedule: draft.schedule, lastRunAt: existing.lastRunAt },
            now
          )
        }
      : { ...draft, id: randomUUID() }
    this.index.jobs[job.id] = job
    this.flush()
    return job
  }

  setEnabled(id: string, enabled: boolean): TimerJob | null {
    const job = this.index.jobs[id]
    if (!job) return null
    job.enabled = enabled
    job.updatedAt = Date.now()
    if (enabled) job.nextRunAt = nextTimerDue(job, Date.now())
    this.flush()
    return job
  }

  deleteJob(id: string): boolean {
    if (!this.index.jobs[id]) return false
    delete this.index.jobs[id]
    for (const [runId, run] of Object.entries(this.index.runs)) {
      if (run.jobId === id) delete this.index.runs[runId]
    }
    this.flush()
    return true
  }

  dueJobs(now: number): TimerJob[] {
    return this.listJobs().filter(
      (job) => job.enabled && job.nextRunAt != null && job.nextRunAt <= now
    )
  }

  isJobRunning(jobId: string): boolean {
    return Object.values(this.index.runs).some(
      (run) => run.jobId === jobId && run.status === 'running'
    )
  }

  beginRun(opts: { jobId: string; sessionId: string; workdir: string; at: number }): TimerRun {
    const run: TimerRun = {
      id: randomUUID(),
      jobId: opts.jobId,
      sessionId: opts.sessionId,
      workdir: opts.workdir,
      startedAt: opts.at,
      endedAt: null,
      status: 'running',
      outputPath: null
    }
    this.index.runs[run.id] = run
    const job = this.index.jobs[opts.jobId]
    if (job) {
      job.lastRunAt = opts.at
      job.updatedAt = opts.at
      job.nextRunAt = nextTimerDue(job, opts.at)
    }
    this.flush()
    return run
  }

  finishRun(runId: string, status: Exclude<TimerRunStatus, 'running'>, outputPath: string | null): void {
    const run = this.index.runs[runId]
    if (!run) return
    run.status = status
    run.endedAt = Date.now()
    run.outputPath = outputPath
    this.flush()
  }

  listSessions(): TimerSessionListEntry[] {
    const conv = this.conversations
    const out: TimerSessionListEntry[] = []
    for (const run of Object.values(this.index.runs)) {
      const job = this.index.jobs[run.jobId]
      const session = conv?.get(run.sessionId)
      out.push({
        jobId: run.jobId,
        jobTitle: job?.title || 'Timer',
        sessionId: run.sessionId,
        title: session?.title || job?.title || 'Timer',
        workdir: run.workdir,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        status: run.status,
        outputPath: run.outputPath,
        updatedAt: session?.updatedAt ?? run.endedAt ?? run.startedAt
      })
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  deleteSessions(sessionIds: string[]): string[] {
    const wanted = new Set(sessionIds)
    const removed: string[] = []
    for (const [runId, run] of Object.entries(this.index.runs)) {
      if (!wanted.has(run.sessionId)) continue
      delete this.index.runs[runId]
      removed.push(run.sessionId)
    }
    if (removed.length) this.flush()
    return removed
  }
}
