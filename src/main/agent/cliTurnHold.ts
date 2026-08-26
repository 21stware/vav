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
