import type { PreviewRef } from './types'

/**
 * How vav feeds workspace focus / block context into a CLI agent host.
 *
 * Prefer launch argv (system-prompt append) over PTY paste — bracketed paste
 * shows up as raw escape sequences and fake "user" text in TUIs like Claude Code.
 */
export type AgentContextLaunchStrategy =
  /** Claude Code: write prompt to a temp file, pass --append-system-prompt-file. */
  | 'claude-append-system-prompt-file'
  /** No silent launch hook for this binary — do not PTY-paste either. */
  | 'none'

export function contextLaunchStrategyForAgent(agentId: string | null | undefined): AgentContextLaunchStrategy {
  if (agentId === 'claude') return 'claude-append-system-prompt-file'
  return 'none'
}

/**
 * System-prompt body for launch injection (not a user message).
 * Kept plain so agents treat it as ambient session context.
 */
export function formatFocusedFileContext(filePath: string): string {
  return [
    'The user is viewing this file in the workspace preview:',
    filePath,
    'Treat it as the primary document for the next request unless they specify otherwise.'
  ].join('\n')
}

export function formatBlockContext(ref: PreviewRef, comment?: string): string {
  const lines = [
    `Selected from ${ref.filePath} · lines ${ref.startLine}–${ref.endLine}`,
    ref.label ? `Label: ${ref.label}` : null,
    '```',
    ref.text,
    '```'
  ].filter((x): x is string => x != null)
  if (comment?.trim()) {
    lines.push('', `User note: ${comment.trim()}`)
  }
  return lines.join('\n')
}

export function formatBlocksContext(
  cards: { ref: PreviewRef; comment: string }[]
): string {
  if (!cards.length) return ''
  return cards.map((c) => formatBlockContext(c.ref, c.comment)).join('\n\n')
}

/**
 * Bracketed-paste into a live TUI (user-initiated block send only).
 * Do not use this for silent session bootstrap — prefer launch argv.
 */
export function encodePtyPaste(text: string, submit = true): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return `\x1b[200~${body}\x1b[201~${submit ? '\r' : ''}`
}
