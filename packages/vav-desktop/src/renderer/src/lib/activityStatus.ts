/** Window / tray activity for one conversation. */
export type WindowActivityStatus = 'running' | 'done' | 'idle'

export function windowActivityStatus(opts: {
  turnRunning: boolean
  ptyRunning: boolean
  resultUnseen: boolean
}): WindowActivityStatus {
  if (opts.turnRunning || opts.ptyRunning) return 'running'
  if (opts.resultUnseen) return 'done'
  return 'idle'
}
