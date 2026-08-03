import type { PreviewRef } from './types'

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
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'avif'].includes(ext)) {
    return 'image'
  }
  if (['pdf'].includes(ext)) return 'pdf'
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) return 'zip'
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio'
  if (
    [
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'pages',
      'numbers',
      'key'
    ].includes(ext)
  ) {
    return 'office'
  }
  if (
    [
      'exe',
      'dll',
      'so',
      'dylib',
      'bin',
      'o',
      'a',
      'wasm',
      'class',
      'pyc'
    ].includes(ext)
  ) {
    return 'binary'
  }
  return 'text'
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
            : resolvedKind === 'binary' ||
                resolvedKind === 'video' ||
                resolvedKind === 'audio'
              ? resolvedKind
              : 'file'
  const hint =
    resolvedKind === 'image'
      ? 'Open this path with vision/read tools for the request below.'
      : 'Read this path for the request below.'
  return [`[vav] Attached ${tag}: ${base}`, filePath, hint].join('\n')
}

/** Compact block note for TUI input (still includes source text). */
export function formatBlockContextBrief(ref: PreviewRef, comment?: string): string {
  const range =
    ref.startLine === ref.endLine
      ? `L${ref.startLine}`
      : `L${ref.startLine}–${ref.endLine}`
  const title = ref.label?.trim() || range
  const lines = [
    `[vav] Selection · ${title} · ${range}`,
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
