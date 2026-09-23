/**
 * Knowledge hosts: ingested documents (chunked for retrieval) and
 * hand-written markdown notes (user + agent editable).
 */
export const KNOWLEDGE_DOC_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.doc',
  '.pptx',
  '.ppt',
  '.xlsx',
  '.xls',
  '.md',
  '.markdown',
  '.txt',
  '.rtf',
  '.html',
  '.htm'
] as const

export type KnowledgeHostKind = 'document' | 'note'

/**
 * Virtual root of the Notes library. It is not stored, always listed first,
 * and cannot be renamed or deleted. Every note appears here; a real folder
 * is a subset.
 */
export const KNOWLEDGE_ALL_NOTES_ID = 'all'

export interface KnowledgeFolder {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeHost {
  id: string
  title: string
  kind: KnowledgeHostKind
  /** Original file the user picked (documents). */
  sourcePath: string | null
  /** Vault copy / note markdown path. */
  storedPath: string | null
  conversationId: string | null
  /** User folder. Null means unfiled — still listed under All Notes. */
  folderId: string | null
  chunkCount: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeNote {
  hostId: string
  markdown: string
  updatedAt: number
}

export interface KnowledgeHostInput {
  title?: string
  kind?: KnowledgeHostKind
  sourcePath?: string | null
  conversationId?: string | null
}

export function extOfKnowledge(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

export function isKnowledgeDocPath(path: string): boolean {
  return (KNOWLEDGE_DOC_EXTENSIONS as readonly string[]).includes(extOfKnowledge(path))
}

export function knowledgeTitleFromPath(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.trim() || base
}

/** First readable line under the title, for the Notes list. */
export function knowledgeNotePreview(markdown: string, max = 140): string {
  const body = markdown
    .replace(/^\uFEFF?/, '')
    .replace(/^#\s+.*(?:\r?\n|$)/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!body) return ''
  if (body.length <= max) return body
  return `${body.slice(0, max - 1).trimEnd()}…`
}

/**
 * The note title is the first heading. Editing the title on the note page
 * rewrites that heading so a later body save does not put the old name back.
 */
export function noteMarkdownWithTitle(markdown: string, title: string): string {
  const next = title.trim()
  if (!next) return markdown
  const heading = `# ${next}`
  const normalized = markdown.replace(/^\uFEFF?/, '')
  if (/^#\s+\S/.test(normalized)) return normalized.replace(/^#\s+.*$/m, () => heading)
  if (!normalized.trim()) return `${heading}\n\n`
  return `${heading}\n\n${normalized.replace(/^\n+/, '')}`
}
