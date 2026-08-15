/**
 * Decide when VAV should hold an OS idle-sleep assertion.
 *
 * A turn waiting on the user (`paused`) is not work — the machine may sleep.
 * An idle CLI pane sitting at a prompt is not work either. Only an actively
 * running VAV/CLI turn, or a CLI agent PTY that is producing output / has
 * children, counts.
 */
export type TurnActivity = 'running' | 'paused'
export type PtyActivity = 'running' | 'idle' | 'exited'

export function hasActiveAgentWork(input: {
  turns?: Iterable<TurnActivity>
  cliAgentStatuses?: Iterable<PtyActivity>
}): boolean {
  if (input.turns) {
    for (const phase of input.turns) {
      if (phase === 'running') return true
    }
  }
  if (input.cliAgentStatuses) {
    for (const status of input.cliAgentStatuses) {
      if (status === 'running') return true
    }
  }
  return false
}

export function shouldBlockIdleSleep(enabled: boolean, hasWork: boolean): boolean {
  return enabled === true && hasWork
}
