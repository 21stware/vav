import { isApprovalApproveText, isApprovalDenyText } from '../../shared/i18n/index.ts'
import { isAskCancelText, isPlanDocRejectText } from './cliHostTurn.ts'

export function cliPermissionAllow(kind: string, text: string): boolean {
  if (kind === 'ask' || kind === 'form') return !isAskCancelText(text)
  if (kind === 'plan_doc') return !isPlanDocRejectText(text)
  if (kind === 'url') return !isAskCancelText(text) && !isApprovalDenyText(text)
  return isApprovalApproveText(text, false)
}

export function cliPermissionStatus(
  kind: string,
  allow: boolean
): 'executing' | 'completed' | 'skipped' {
  if (!allow) return 'skipped'
  return kind === 'permission' ? 'executing' : 'completed'
}

export function cliPermissionOutput(
  kind: string,
  allow: boolean,
  text: string,
  labels: { accepted: string; rejected: string; approved: string; denied: string }
): string {
  if (kind === 'ask') return text
  if (kind === 'plan_doc') return allow ? labels.accepted : labels.rejected
  return allow ? labels.approved : labels.denied
}

/** Prefer the map key; otherwise match a waiter whose payload toolCallId differs. */
export function findPendingPermission<T extends { toolCallId: string }>(
  pending: Map<string, T>,
  toolCallId: string
): T | undefined {
  return pending.get(toolCallId) || [...pending.values()].find((p) => p.toolCallId === toolCallId)
}

/** Stamp a permission card after the user answers; clear interactive choices. */
export function patchedPermissionToolBlock<T extends object>(
  block: T,
  kind: string,
  allow: boolean,
  text: string,
  labels: { accepted: string; rejected: string; approved: string; denied: string }
): T & {
  status: 'executing' | 'completed' | 'skipped'
  output: string
  choices: undefined
} {
  return {
    ...block,
    status: cliPermissionStatus(kind, allow),
    output: cliPermissionOutput(kind, allow, text, labels),
    choices: undefined
  }
}
