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
