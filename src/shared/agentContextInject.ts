import type { PreviewRef } from './types'
import { formatPreviewLineRange, hasKnownLineRange } from './previewContext.ts'
import { previewKind } from './previewKind.ts'

/**
 * How vav feeds workspace focus / block context into a CLI agent host.
 *
 * Prefer launch argv (system-prompt append) when the binary supports it.
 * Otherwise deliver the same text into the TUI prompt buffer (no auto-submit)
 * so the user sees it and it rides with the next message — never silent
 * bracketed-paste-as-fake-user-turn at bootstrap.
 */
export type AgentContextLaunchStrategy =
  /** Claude Code: write prompt to a temp file, pass --append-system-prompt-file. */
  | 'claude-append-system-prompt-file'
  /**
   * No launch-time flag. Context is delivered via prompt paste (submit: false)
   * after spawn / on restore when focus is present.
   */
  | 'prompt-paste'

export function contextLaunchStrategyForAgent(
  agentId: string | null | undefined
): AgentContextLaunchStrategy {
  if (agentId === 'claude') return 'claude-append-system-prompt-file'
  // Grok / Codex / Cursor / Devin / Pi / unknown: no portable ambient flag.
  return 'prompt-paste'
}

/** True when spawn can carry context without touching the TTY. */
export function launchCarriesContext(
  strategy: AgentContextLaunchStrategy | null | undefined
): boolean {
  return strategy === 'claude-append-system-prompt-file'
}

/**
 * Guess a coarse file kind from path when preview kind is unavailable.
 * Used to write better ambient instructions (esp. images).
 */
export function sniffFileKind(filePath: string): string {
  const kind = previewKind(filePath)
  if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') return 'office'
  // previewKind treats these as binary; agents should still open them as documents / archives.
  if (/\.(doc|ppt|pages|numbers|key)$/i.test(filePath)) return 'office'
  if (/\.(tar|tgz|gz|rar|7z)$/i.test(filePath)) return 'zip'
  return kind
}

/**
 * System-prompt / ambient body for launch injection or prompt paste.
 * Path is absolute so agents can open it with their own tools.
 */
export function formatFocusedFileContext(
  filePath: string,
  kind?: string | null
): string {
  const resolvedKind = (kind?.trim() || sniffFileKind(filePath)).toLowerCase()
  const lines = [
    'Workspace focus (selected in the vav preview — treat as attached context):',
    filePath
  ]

  if (resolvedKind === 'image') {
    lines.push(
      '',
      'This is an image at the absolute path above.',
      'Open or inspect that path with vision/image tools if you have them, or describe it after reading the file.',
      'Do not claim you cannot see an attachment without first trying that path.'
    )
  } else if (resolvedKind === 'pdf' || resolvedKind === 'office') {
    lines.push(
      '',
      `This is a ${resolvedKind === 'pdf' ? 'PDF' : 'office'} document.`,
      'Read it from the path above with your document/file tools when you need its contents.'
    )
  } else if (resolvedKind === 'html' || resolvedKind === 'html-clip') {
    lines.push(
      '',
      resolvedKind === 'html-clip'
        ? 'This is an interactive HTML clip. Treat it as a rendered surface; do not rewrite it as ordinary source unless the user asks.'
        : 'This is an HTML document. Read it from the path above; picks refer to elements, not always to a source line.'
    )
  } else if (resolvedKind === 'sqlite') {
    lines.push(
      '',
      'This is a SQLite database. Inspect tables at the path above; do not treat it as a text file.'
    )
  } else if (resolvedKind === 'csv') {
    lines.push(
      '',
      'This is a CSV/TSV sheet. Prefer the path above (or a selected row/cell) over pasting the whole file.'
    )
  } else if (resolvedKind === 'zip') {
    lines.push(
      '',
      'This is an archive. Reference entries by path; extract only if needed.'
    )
  } else if (resolvedKind === 'binary' || resolvedKind === 'video' || resolvedKind === 'audio') {
    lines.push(
      '',
      `This is a ${resolvedKind} file. Only path/metadata may be available unless you can open it with specialized tools.`
    )
  } else {
    lines.push(
      '',
      'Treat it as the primary document for the next request unless the user specifies otherwise.',
      'Read the file at this path when you need its contents — do not wait for a full paste of the body.'
    )
  }

  return lines.join('\n')
}

export function formatBlockContext(ref: PreviewRef, comment?: string): string {
  const range = formatPreviewLineRange(ref.startLine, ref.endLine)
  const lines = [
    range ? `Selected from ${ref.filePath} · ${range}` : `Selected from ${ref.filePath}`,
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
 * Compact focus line for the TUI input — scannable, not a system monologue.
 * Full ambient text ({@link formatFocusedFileContext}) stays for launch argv.
 */
export function formatFocusedFileContextBrief(
  filePath: string,
  kind?: string | null
): string {
  const base = filePath.split(/[/\\]/).pop() || filePath
  const resolvedKind = (kind?.trim() || sniffFileKind(filePath)).toLowerCase()
  const tag =
    resolvedKind === 'image'
      ? 'image'
      : resolvedKind === 'pdf'
        ? 'pdf'
        : resolvedKind === 'office'
          ? 'document'
          : resolvedKind === 'zip'
            ? 'archive'
            : resolvedKind === 'sqlite'
              ? 'database'
              : resolvedKind === 'html' || resolvedKind === 'html-clip'
                ? 'html'
                : resolvedKind === 'csv'
                  ? 'sheet'
                  : resolvedKind === 'binary' ||
                      resolvedKind === 'video' ||
                      resolvedKind === 'audio'
                    ? resolvedKind
                    : 'file'
  const hint =
    resolvedKind === 'image'
      ? 'Open this path with vision/read tools for the request below.'
      : 'Read this path for the request below.'
  return [`[VAV] Attached ${tag}: ${base}`, filePath, hint].join('\n')
}

/** Compact block note for TUI input (still includes source text). */
export function formatBlockContextBrief(ref: PreviewRef, comment?: string): string {
  const range = formatPreviewLineRange(ref.startLine, ref.endLine)
  const rangeTag = hasKnownLineRange(ref.startLine, ref.endLine)
    ? ref.startLine === ref.endLine
      ? `L${ref.startLine}`
      : `L${ref.startLine}–${ref.endLine}`
    : ''
  const title = ref.label?.trim() || rangeTag || range || 'selection'
  const rangeAlreadyInTitle = !!(range && ref.label?.includes(range))
  const head =
    rangeTag && ref.label?.trim() && !rangeAlreadyInTitle
      ? `[VAV] Selection · ${title} · ${rangeTag}`
      : `[VAV] Selection · ${title}`
  const lines = [
    head,
    ref.filePath,
    '```',
    ref.text,
    '```'
  ]
  if (comment?.trim()) lines.push(`Note: ${comment.trim()}`)
  return lines.join('\n')
}

export function formatBlocksContextBrief(
  cards: { ref: PreviewRef; comment: string }[]
): string {
  if (!cards.length) return ''
  return cards.map((c) => formatBlockContextBrief(c.ref, c.comment)).join('\n\n')
}

/**
 * Workspace focus for CLI.
 * - `ambient` — long form for system-prompt / launch argv
 * - `prompt` — brief form for TUI paste (sits above the user draft)
 */
export function buildWorkspaceFocusContext(options: {
  focusedPath?: string | null
  focusedKind?: string | null
  cards?: { ref: PreviewRef; comment: string }[]
  style?: 'ambient' | 'prompt'
}): string | null {
  const style = options.style ?? 'ambient'
  const parts: string[] = []
  const path = options.focusedPath?.trim() || null
  if (path) {
    parts.push(
      style === 'prompt'
        ? formatFocusedFileContextBrief(path, options.focusedKind)
        : formatFocusedFileContext(path, options.focusedKind)
    )
  }
  const cards = options.cards ?? []
  if (cards.length) {
    parts.push(
      style === 'prompt' ? formatBlocksContextBrief(cards) : formatBlocksContext(cards)
    )
  }
  const text = parts.join('\n\n').trim()
  return text || null
}

/**
 * Build the string that lands in the CLI TUI prompt:
 * focus block first (if any), then the user's draft at the end so they can
 * keep editing the actual question. Trailing blank line when only context.
 */
export function composeCliPromptPaste(options: {
  context?: string | null
  draft?: string | null
}): string | null {
  const context = options.context?.trim() || ''
  const draft = options.draft?.trim() || ''
  if (!context && !draft) return null
  if (!context) return draft
  if (!draft) return `${context}\n\n`
  return `${context}\n\n---\n${draft}`
}

/** Stable fingerprint so we do not re-stack the same focus+draft into a pane. */
export function cliPromptFingerprint(context: string | null, draft: string | null): string {
  return `${(context ?? '').trim()}\u0000${(draft ?? '').trim()}`
}

/**
 * Bracketed-paste into a live TUI (prompt fill or user-initiated block send).
 * Prefer launch argv for silent session bootstrap when the binary supports it.
 */
export function encodePtyPaste(text: string, submit = true): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return `\x1b[200~${body}\x1b[201~${submit ? '\r' : ''}`
}
