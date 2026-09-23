import { parseAppResourceUrl } from './appResourceUrl.ts'

export type KnowledgeNoteDraft = {
  hostId: string
  markdown: string
  /** First heading or an explicit title arg. Null until one is visible. */
  title: string | null
}

export type KnowledgeNoteDraftContext = {
  /** Knowledge host focused in the app column, if the open item is a note. */
  focusedHostId?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '')
}

/** Title the note list should show while markdown is still streaming. */
export function knowledgeNoteTitle(markdown: string, explicit?: string | null): string | null {
  const given = explicit?.trim()
  if (given) return given
  const heading = markdown.match(/^#\s+(\S.*?)\s*$/m)?.[1]?.trim()
  return heading || null
}

/**
 * Partial note body while the model is still generating a knowledge write.
 * Returns null until there is a target host and a non-empty body.
 */
export function knowledgeNoteDraft(
  name: string,
  input: unknown,
  ctx: KnowledgeNoteDraftContext = {}
): KnowledgeNoteDraft | null {
  const n = toolName(name)
  const args = asRecord(input) ?? {}

  if (
    n === 'knowledge_write' ||
    n === 'knowledgewrite' ||
    n === 'note_edit' ||
    n === 'noteedit'
  ) {
    const markdown = asString(args.markdown)
    const hostId =
      asString(args.host_id)?.trim() ||
      asString(args.hostId)?.trim() ||
      (n === 'note_edit' || n === 'noteedit' ? ctx.focusedHostId?.trim() : '') ||
      ''
    if (!hostId || !markdown) return null
    return { hostId, markdown, title: knowledgeNoteTitle(markdown, asString(args.title)) }
  }

  if (n === 'app') {
    const op = asString(args.op)?.trim().toLowerCase()
    if (op !== 'write') return null
    const markdown = asString(args.content)
    if (!markdown) return null
    const url = asString(args.url)?.trim() ?? ''
    const ref = url ? parseAppResourceUrl(url) : null
    if (url && !ref) return null
    if (ref && ref.kind !== 'knowledge') return null
    const kind = asString(args.kind)?.trim() || ref?.kind || ''
    if (kind && kind !== 'knowledge') return null
    const hostId =
      (ref?.kind === 'knowledge' ? ref.id?.trim() : '') || ctx.focusedHostId?.trim() || ''
    if (!hostId) return null
    return { hostId, markdown, title: knowledgeNoteTitle(markdown, asString(args.title)) }
  }

  return null
}
