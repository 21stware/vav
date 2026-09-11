import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatTimerStamp, type TimerJob } from '@shared/timer'

export function mintTimerWorkdir(tmp: string, jobId: string, at: number): string {
  const dir = join(tmp, 'vav', 'timer', jobId.slice(0, 8), formatTimerStamp(at), 'Workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** One Workspace folder reused for every run of this scheduled task. */
export function stickyTimerWorkdir(tmp: string, jobId: string): string {
  const dir = join(tmp, 'vav', 'timer', jobId.slice(0, 8), 'Workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function resolveTimerWorkdir(
  job: Pick<TimerJob, 'id' | 'workdirPolicy' | 'sourceWorkdir'>,
  tmp: string,
  now: number
): string {
  if (job.workdirPolicy === 'source' && job.sourceWorkdir && existsSync(job.sourceWorkdir)) {
    return job.sourceWorkdir
  }
  if (job.workdirPolicy === 'sticky') return stickyTimerWorkdir(tmp, job.id)
  return mintTimerWorkdir(tmp, job.id, now)
}
