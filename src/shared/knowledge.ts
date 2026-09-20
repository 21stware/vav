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

export interface KnowledgeHost {
  id: string
  title: string
  kind: KnowledgeHostKind
  /** Original file the user picked (documents). */
  sourcePath: string | null
  /** Vault copy / note markdown path. */
  storedPath: string | null
  conversationId: string | null
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
