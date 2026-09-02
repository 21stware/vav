import type { ToolName } from '../../shared/types.ts'
import {
  FILE_READONLY_BLOCKED_TOOLS,
  isReadonlyTerminalCommand
} from './fileEditLock.ts'
import { HIGH_RISK_TOOLS, INTERACTIVE_TOOLS, READONLY_TOOLS } from './toolSets.ts'

export function terminalCommandFromArgs(name: string, args: unknown): string {
  if (name !== 'terminal' || !args || typeof args !== 'object' || !('command' in args)) return ''
  return String((args as { command: unknown }).command ?? '')
}

export function shouldSkipToolGate(name: ToolName): boolean {
  return (
    INTERACTIVE_TOOLS.has(name) ||
    name === 'plan' ||
    name === 'wait' ||
    name === 'read_bash_session'
  )
}

/** Hard-block writes in file-preview Read before the approval card. */
export function readonlyApprovalBlock(
  name: ToolName,
  command: string
): { block: true; reason: string } | null {
  if (FILE_READONLY_BLOCKED_TOOLS.has(name)) {
    return {
      block: true,
      reason:
        'Read-only session: call switch_mode with mode "edit" first (or ask the user to switch / convert / Save As).'
    }
  }
  if (name === 'terminal' && command && !isReadonlyTerminalCommand(command)) {
    return {
      block: true,
      reason: `Read-only session: only read-only shell commands are allowed until Edit (refused: ${command.slice(0, 120)})`
    }
  }
  return null
}

/** Bypass writes already on disk — auto-accept; no review gate. */
export function shouldAutoAcceptChangeSet(mode: string | null | undefined): boolean {
  return mode === 'bypass'
}

export function shouldPauseForApproval(opts: {
  mode: string
  name: ToolName
  command: string
  autoApproveReadonly: boolean
}): boolean {
  if (shouldAutoAcceptChangeSet(opts.mode)) return false
  if (opts.mode === 'auto') {
    const highRisk =
      HIGH_RISK_TOOLS.has(opts.name) &&
      !(opts.name === 'terminal' && isReadonlyTerminalCommand(opts.command))
    const readonlyNeedsApproval = READONLY_TOOLS.has(opts.name) && !opts.autoApproveReadonly
    return highRisk || readonlyNeedsApproval
  }
  // Edit: every non-interactive tool pauses.
  return true
}

/** Body after Approve in Edit mode; empty means keep the original args. */
export function parseEditedApprovalText(
  text: string,
  approveLabel: string,
  isApprove: (text: string) => boolean
): string {
  if (text.startsWith(`${approveLabel}\n`)) return text.slice(approveLabel.length + 1)
  if (isApprove(text) || text === approveLabel) return ''
  return text
}

/** Edit vs Auto labels, title, and optional editable summary for the approval card. */
export function approvalPromptCopy(opts: {
  mode: string
  summary: string
  auto: { approve: string; deny: string; title: string }
  edit: { approve: string; deny: string; title: string }
}): {
  approveLabel: string
  denyLabel: string
  title: string
  editable: string
  prompt: string
} {
  const edit = opts.mode === 'edit'
  const labels = edit ? opts.edit : opts.auto
  return {
    approveLabel: labels.approve,
    denyLabel: labels.deny,
    title: labels.title,
    editable: edit ? opts.summary : '',
    prompt: `${labels.title}\n${opts.summary}`
  }
}

/** switch_mode must still reach the user so Read can become Edit. */
export function readonlyGateApplies(
  fileReadOnly: boolean | undefined,
  name: string
): boolean {
  return !!fileReadOnly && name !== 'switch_mode'
}

/** Card title: existing summary, else the shell command, else a tool-input summary. */
export function approvalCardSummary(
  blockSummary: string | undefined,
  command: string,
  summarize: () => string
): string {
  if (blockSummary) return blockSummary
  if (command) return command
  return summarize()
}

export type ApprovalAnswerKind = 'cancelled' | 'denied' | 'approved'

export function approvalAnswerKind(
  answer: { cancelled: boolean; text: string },
  denyLabel: string,
  isDeny: (text: string) => boolean
): ApprovalAnswerKind {
  if (answer.cancelled) return 'cancelled'
  if (answer.text === denyLabel || isDeny(answer.text)) return 'denied'
  return 'approved'
}
