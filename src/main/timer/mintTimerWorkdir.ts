import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatTimerStamp } from '@shared/timer'

export function mintTimerWorkdir(tmp: string, jobId: string, at: number): string {
  const dir = join(tmp, 'vav', 'timer', jobId.slice(0, 8), formatTimerStamp(at), 'Workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}
