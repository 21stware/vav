/**
 * Composer-specific mention tokens.
 *
 * Per the design: a pill is a *visual* layer only — the underlying draft text
 * holds a plain placeholder that is exactly what gets sent. So a mention is
 * self-describing text, and this module just tells the highlighter where the
 * pills are:
 *   - files  → a real path (detected with the shared file-path scanner), sent
 *              as-is (the agent already treats paths as links)
 *   - apps   → `@[App Name]`, sent as-is (the agent resolves it via the cua
 *              daemon's computer_list at run time)
 *
 * No registry, no send-path rewrite.
 */
import { findFilePathMentions } from '@shared/filePathMentions'

/** Matches an app placeholder like `@[Google Chrome]`. */
export const APP_TOKEN_RE = /@\[[^\]\n]+\]/g

/** Build the inline placeholder for an app mention. */
export function appMentionToken(name: string): string {
  const clean = name
    .replace(/[[\]\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `@[${clean}]`
}

/** Extract the app name from a `@[Name]` token, or null. */
export function appNameFromToken(token: string): string | null {
  const m = /^@\[([^\]\n]+)\]$/.exec(token)
  return m ? m[1]! : null
}

export type ComposerPillKind = 'file' | 'app'

export type ComposerPill = {
  start: number
  end: number
  /** Human label (file path or app name). */
  name: string
  kind: ComposerPillKind
}

/**
 * Find every inline pill in the draft: app placeholders and file paths.
 * Ranges are sorted and non-overlapping (earlier match wins on the rare tie).
 */
export function findComposerPills(text: string): ComposerPill[] {
  const pills: ComposerPill[] = []

  const re = new RegExp(APP_TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    pills.push({
      start: m.index,
      end: m.index + m[0].length,
      name: appNameFromToken(m[0]) ?? m[0],
      kind: 'app'
    })
  }

  for (const file of findFilePathMentions(text)) {
    pills.push({
      start: file.index,
      end: file.index + file.raw.length,
      name: file.path,
      kind: 'file'
    })
  }

  pills.sort((a, b) => a.start - b.start)
  const out: ComposerPill[] = []
  let cursor = 0
  for (const pill of pills) {
    if (pill.start < cursor) continue // drop overlaps
    out.push(pill)
    cursor = pill.end
  }
  return out
}
