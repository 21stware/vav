import {
  goalSlashText,
  goalUsesRpc,
  type GoalAction,
  type GoalCapability
} from '../../shared/acpSession.ts'

export type SessionGoalResult =
  | { ok: true; via: 'rpc' }
  | { ok: true; via: 'slash'; text: string }
  | { ok: false; error: string }

/** Decide RPC vs slash before touching the live driver. */
export function planSessionGoal(input: {
  capability: GoalCapability | null | undefined
  action: GoalAction
  objective?: string
  connected: boolean
}): SessionGoalResult {
  const cap = input.capability
  if (!cap || !cap.actions.includes(input.action)) {
    return { ok: false, error: 'Goal control is not available' }
  }
  if (input.action === 'set' && !input.objective?.trim()) {
    return { ok: false, error: 'Goal objective is required' }
  }
  if (goalUsesRpc(cap, input.action)) {
    if (!input.connected) return { ok: false, error: 'Agent is not connected' }
    return { ok: true, via: 'rpc' }
  }
  return { ok: true, via: 'slash', text: goalSlashText(input.action, input.objective) }
}
