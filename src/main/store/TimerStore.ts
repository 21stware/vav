import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  coerceTimerSchedule,
  nextTimerRunAt,
  type TimerJob,
  type TimerJobInput,
  type TimerRun,
  type TimerRunStatus
} from '@shared/timer'
import { isConnectorId, type ConnectorId } from '@shared/connector'

function coerceJob(raw: unknown, now: number): TimerJob | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id.trim()) return null
  if (typeof row.title !== 'string' || !row.title.trim()) return null
  if (typeof row.prompt !== 'string') return null
  const schedule = coerceTimerSchedule(row.schedule)
  if (!schedule) return null
  const connectorIds = Array.isArray(row.connectorIds)
    ? row.connectorIds.filter(isConnectorId)
    : []
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : now
  const lastRunAt = typeof row.lastRunAt === 'number' ? row.lastRunAt : null
  const nextRunAt =
    typeof row.nextRunAt === 'number'
      ? row.nextRunAt
      : nextTimerRunAt(schedule, lastRunAt ?? createdAt)
  return {
    id: row.id,
    title: row.title.trim(),
    prompt: row.prompt,
    schedule,
    enabled: row.enabled !== false,
    conversationId: typeof row.conversationId === 'string' && row.conversationId.trim() ? row.conversationId : null,
    workdirPolicy: row.workdirPolicy === 'source' ? 'source' : 'mint',
    sourceWorkdir: typeof row.sourceWorkdir === 'string' ? row.sourceWorkdir : null,
    connectorIds: connectorIds as ConnectorId[],
    createdAt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : createdAt,
    lastRunAt,
    nextRunAt,
    lastStatus:
      row.lastStatus === 'ok' || row.lastStatus === 'failed' || row.lastStatus === 'running'
        ? row.lastStatus
        : null
  }
}

function coerceRun(raw: unknown): TimerRun | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.jobId !== 'string') return null
  if (typeof row.conversationId !== 'string' || typeof row.workdir !== 'string') return null
  if (typeof row.startedAt !== 'number') return null
  const status = row.status
  if (status !== 'running' && status !== 'done' && status !== 'failed' && status !== 'skipped') {
    return null
  }
  return {
    id: row.id,
    jobId: row.jobId,
    conversationId: row.conversationId,
    startedAt: row.startedAt,
    finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : null,
    status: status as TimerRunStatus,
    workdir: row.workdir,
    outputPath: typeof row.outputPath === 'string' ? row.outputPath : null,
    error: typeof row.error === 'string' ? row.error : null
  }
}

export class TimerStore {
  private readonly jobsPath: string
  private readonly runsPath: string
  private readonly migrateFrom: string | null
  private jobs: TimerJob[] = []
  private runs: TimerRun[] = []

  constructor(stateDir: string, options?: { migrateFrom?: string | null }) {
    const dir = join(stateDir, 'timers')
    this.jobsPath = join(dir, 'jobs.json')
    this.runsPath = join(dir, 'runs.json')
    this.migrateFrom = options?.migrateFrom?.trim() || null
  }

  load(): void {
    this.migrateFromUserData()
    this.jobs = this.readList(this.jobsPath, (row) => coerceJob(row, Date.now()))
    this.runs = this.readList(this.runsPath, coerceRun)
  }

  listJobs(): TimerJob[] {
    return this.jobs.map((job) => ({ ...job, connectorIds: [...job.connectorIds] }))
  }

  getJob(id: string): TimerJob | undefined {
    return this.jobs.find((job) => job.id === id)
  }

  getJobForConversation(conversationId: string): TimerJob | undefined {
    const id = conversationId.trim()
    if (!id) return undefined
    return this.jobs.find((job) => job.conversationId === id)
  }

  listRuns(jobId?: string): TimerRun[] {
    const rows = jobId ? this.runs.filter((run) => run.jobId === jobId) : this.runs
    return rows
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => ({ ...run }))
  }

  getRun(id: string): TimerRun | undefined {
    return this.runs.find((run) => run.id === id)
  }

  createJob(input: TimerJobInput, now = Date.now()): TimerJob {
    const schedule = coerceTimerSchedule(input.schedule)
    if (!schedule) throw new Error('Invalid timer schedule')
    const title = input.title.trim() || 'Scheduled task'
    const prompt = input.prompt.trim()
    const job: TimerJob = {
      id: randomUUID(),
      title,
      prompt,
      schedule,
      enabled: input.enabled !== false,
      conversationId: input.conversationId?.trim() || null,
      workdirPolicy: input.workdirPolicy === 'source' ? 'source' : 'mint',
      sourceWorkdir: input.sourceWorkdir ?? null,
      connectorIds: (input.connectorIds ?? []).filter(isConnectorId),
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: input.enabled === false ? null : nextTimerRunAt(schedule, now),
      lastStatus: null
    }
    this.jobs.unshift(job)
    this.persistJobs()
    return { ...job, connectorIds: [...job.connectorIds] }
  }

  updateJob(id: string, patch: Partial<TimerJobInput> & { enabled?: boolean }, now = Date.now()): TimerJob | null {
    const job = this.jobs.find((row) => row.id === id)
    if (!job) return null
    if (typeof patch.title === 'string' && patch.title.trim()) job.title = patch.title.trim()
    if (typeof patch.prompt === 'string') job.prompt = patch.prompt.trim()
    if (patch.conversationId !== undefined) {
      job.conversationId = patch.conversationId?.trim() || null
    }
    if (patch.schedule) {
      const schedule = coerceTimerSchedule(patch.schedule)
      if (!schedule) throw new Error('Invalid timer schedule')
      job.schedule = schedule
    }
    if (typeof patch.enabled === 'boolean') job.enabled = patch.enabled
    if (patch.workdirPolicy === 'mint' || patch.workdirPolicy === 'source') {
      job.workdirPolicy = patch.workdirPolicy
    }
    if (patch.sourceWorkdir !== undefined) job.sourceWorkdir = patch.sourceWorkdir
    if (patch.connectorIds) job.connectorIds = patch.connectorIds.filter(isConnectorId)
    job.updatedAt = now
    job.nextRunAt = job.enabled ? nextTimerRunAt(job.schedule, job.lastRunAt ?? now) : null
    this.persistJobs()
    return { ...job, connectorIds: [...job.connectorIds] }
  }

  removeJob(id: string): boolean {
    const before = this.jobs.length
    this.jobs = this.jobs.filter((job) => job.id !== id)
    this.runs = this.runs.filter((run) => run.jobId !== id)
    if (this.jobs.length === before) return false
    this.persistJobs()
    this.persistRuns()
    return true
  }

  dueJobs(now = Date.now()): TimerJob[] {
    return this.jobs.filter(
      (job) => job.enabled && job.nextRunAt != null && job.lastStatus !== 'running' && job.nextRunAt <= now
    )
  }

  beginRun(input: {
    jobId: string
    conversationId: string
    workdir: string
    now?: number
  }): TimerRun | null {
    const job = this.jobs.find((row) => row.id === input.jobId)
    if (!job) return null
    const now = input.now ?? Date.now()
    const run: TimerRun = {
      id: randomUUID(),
      jobId: job.id,
      conversationId: input.conversationId,
      startedAt: now,
      finishedAt: null,
      status: 'running',
      workdir: input.workdir,
      outputPath: null,
      error: null
    }
    job.lastRunAt = now
    job.lastStatus = 'running'
    job.updatedAt = now
    this.runs.unshift(run)
    this.persistJobs()
    this.persistRuns()
    return { ...run }
  }

  finishRun(
    runId: string,
    result: { status: Exclude<TimerRunStatus, 'running'>; outputPath?: string | null; error?: string | null },
    now = Date.now()
  ): TimerRun | null {
    const run = this.runs.find((row) => row.id === runId)
    if (!run) return null
    run.status = result.status
    run.finishedAt = now
    run.outputPath = result.outputPath ?? run.outputPath
    run.error = result.error ?? null
    const job = this.jobs.find((row) => row.id === run.jobId)
    if (job) {
      job.lastStatus = result.status === 'done' ? 'ok' : result.status === 'failed' ? 'failed' : job.lastStatus
      job.nextRunAt =
        job.enabled && job.schedule.kind !== 'once'
          ? nextTimerRunAt(job.schedule, now + 1)
          : null
      if (job.schedule.kind === 'once') job.enabled = false
      job.updatedAt = now
    }
    this.persistJobs()
    this.persistRuns()
    return { ...run }
  }

  private readList<T>(path: string, coerce: (raw: unknown) => T | null): T[] {
    try {
      if (!existsSync(path)) return []
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      const rows = Array.isArray(parsed) ? parsed : []
      return rows.map(coerce).filter((row): row is T => row != null)
    } catch {
      return []
    }
  }

  private migrateFromUserData(): void {
    if (!this.migrateFrom || existsSync(this.jobsPath)) return
    const legacyJobs = join(this.migrateFrom, 'timers', 'jobs.json')
    if (!existsSync(legacyJobs)) return
    try {
      mkdirSync(dirname(this.jobsPath), { recursive: true })
      copyFileSync(legacyJobs, this.jobsPath)
      const legacyRuns = join(this.migrateFrom, 'timers', 'runs.json')
      if (existsSync(legacyRuns) && !existsSync(this.runsPath)) {
        copyFileSync(legacyRuns, this.runsPath)
      }
    } catch (err) {
      console.error('[timers] migrate from userData failed', err)
    }
  }

  private persistJobs(): void {
    this.writeJson(this.jobsPath, this.jobs)
  }

  private persistRuns(): void {
    this.writeJson(this.runsPath, this.runs.slice(0, 200))
  }

  private writeJson(path: string, value: unknown): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
    } catch (err) {
      console.error('[timers] persist failed', err)
    }
  }
}
