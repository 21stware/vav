/**
 * Hosts sometimes return from the live prompt while a plan / ask card is
 * still waiting. Sealing the VAV turn there ends the thread after Accept
 * (one follow-up, then nothing to resume). Hold the turn instead.
 */
export function shouldDeferCliTurnFinish(
  pendingCount: number,
  cancelled: boolean
): boolean {
  return pendingCount > 0 && !cancelled
}

/**
 * After the user answers the last held card, the host prompt is already gone
 * — kick a follow-up on the same VAV turn so Accept plan keeps implementing.
 */
export function shouldContinueHeldCliTurn(opts: {
  hostPromptClosed: boolean
  remaining: number
  allow: boolean
  alreadySteered: boolean
}): boolean {
  return opts.hostPromptClosed && opts.remaining === 0 && opts.allow && !opts.alreadySteered
}

/**
 * Cursor orders it the other way round: `cursor/create_plan` blocks while
 * `session/prompt` stays in flight, and right after Accept the agent ends
 * the turn (stopReason end_turn) WITHOUT implementing — the client must
 * send the follow-up prompt itself. Arm that follow-up when a plan card is
 * accepted while the host prompt is still open; it fires on the coming
 * turn-finished unless the agent visibly continued on its own.
 */
export function shouldArmPlanDocFollowUp(opts: {
  kind: string
  allow: boolean
  hostPromptClosed: boolean
  remaining: number
  alreadySteered: boolean
}): boolean {
  return (
    opts.kind === 'plan_doc' &&
    opts.allow &&
    !opts.hostPromptClosed &&
    opts.remaining === 0 &&
    !opts.alreadySteered
  )
}

/**
 * Reject on the last held card after the host prompt closed — seal the VAV
 * turn. Accept's dual: do not leave a zombie held turn after Deny.
 */
export function shouldSealHeldCliReject(opts: {
  hostPromptClosed: boolean
  remaining: number
  allow: boolean
}): boolean {
  return !opts.allow && opts.hostPromptClosed && opts.remaining === 0
}
