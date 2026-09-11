/** Tray / Dock attention from a live turn phase. */
export function activeTurnStatusFromPhase(
  phase: string
): 'paused' | 'running' | null {
  if (phase === 'awaiting-user') return 'paused'
  if (
    phase === 'working' ||
    phase === 'thinking' ||
    phase === 'outputting' ||
    phase === 'retrying' ||
    phase === 'reconnecting' ||
    phase === 'healing'
  ) {
    return 'running'
  }
  return null
}

/** Notification kind for a parked tool card. Null means no OS alert. */
export function awaitingNotifyKind(
  tool: string,
  hasChoices: boolean
): 'ask' | 'approval' | 'request' | 'secret' | null {
  if (tool === 'ask_user_question') return 'ask'
  if (tool === 'request_for_secret') return 'secret'
  if (tool === 'plan_doc') return 'approval'
  if (tool === 'request') return 'request'
  if (hasChoices) return 'approval'
  return null
}

/** OS alert title for a parked tool. Caller injects already-translated strings. */
export function awaitingNotifyTitle(
  kind: 'ask' | 'approval' | 'request' | 'secret',
  titles: { ask: string; request: string; approval: string; secret: string }
): string {
  if (kind === 'ask') return titles.ask
  if (kind === 'request') return titles.request
  if (kind === 'secret') return titles.secret
  return titles.approval
}

/** Successful turns ping Dock; cancelled/errored turns only drop the badge. */
export function turnCompleteNotifyAction(
  cancelled: boolean | undefined,
  error?: string | null
): 'complete' | 'acknowledge' {
  return !cancelled && !error ? 'complete' : 'acknowledge'
}
