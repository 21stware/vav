import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatTimerStamp } from '../../shared/timer.ts'

export const TIMER_WORKSPACE_FOLDER = 'Workspace'

/** Durable timer workdir: `{root}/timers/{jobId}/{YYYYMMDD-HHmmss}/Workspace`. */
export function mintTimerWorkspace(root: string, jobId: string, at: number): string {
  const stamp = formatTimerStamp(at)
  const dir = join(root, 'timers', jobId, stamp, TIMER_WORKSPACE_FOLDER)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function timerWorkspaceRoot(stateDir: string): string {
  return stateDir
}
