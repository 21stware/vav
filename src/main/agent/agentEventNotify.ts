/** Tray / Dock attention from a live turn phase. */
export function activeTurnStatusFromPhase(
  phase: string
): 'paused' | 'running' | null {
  if (phase === 'awaiting-user') return 'paused'
  if (
    phase === 'working' ||
    phase === 'thinking' ||
    phase === 'outputting' ||
    phase === 'retrying'
  ) {
    return 'running'
  }
  return null
}

/** Notification kind for a parked tool card. Null means no OS alert. */
export function awaitingNotifyKind(
  tool: string,
  hasChoices: boolean
): 'ask' | 'approval' | 'request' | null {
  if (tool === 'ask_user_question') return 'ask'
  if (tool === 'plan_doc') return 'approval'
  if (tool === 'request') return 'request'
  if (hasChoices) return 'approval'
  return null
}
