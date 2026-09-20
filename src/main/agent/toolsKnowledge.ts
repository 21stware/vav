import { TOOL_LABELS } from '@shared/types'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { cap } from './toolSummarize'
import type { KnowledgeStore } from '../store/KnowledgeStore'

export function createKnowledgeTools(host: ToolHost) {
  const knowledgeSearch = defineTool({
    name: 'knowledge_search',
    label: TOOL_LABELS.knowledge_search,
    description:
      'Search across Knowledge hosts (imported documents and notes). Prefer this over guessing note contents. Pass host_id to search one host; omit to search all.',
    parameters: Type.Object({
      query: Type.String({ description: 'Keywords or a natural-language question.' }),
      host_id: Type.Optional(Type.String({ description: 'Limit search to this knowledge host id.' })),
      top_k: Type.Optional(Type.Number({ description: 'How many chunks to return (default 8, max 20).' }))
    }),
    async execute(_id, params) {
      if (!host.retrieval || !host.knowledge) return failure('Knowledge retrieval is unavailable')
      const query = String(params.query ?? '').trim()
      if (!query) return failure('Provide query')
      const topK = Number(params.top_k ?? 8)
      const hostId = String(params.host_id ?? '').trim()
      const targets = host.knowledge
        .searchTargets()
        .filter((row) => !hostId || row.id === hostId || row.path === hostId)
      if (targets.length === 0) {
        return failure(hostId ? `No knowledge host matches ${hostId}` : 'No knowledge hosts yet')
      }
      const hits: string[] = []
      for (const target of targets) {
        const result = await host.retrieval.search({ path: target.path, query, topK })
        if (result.error) {
          hits.push(`# ${target.title}\n${result.error}`)
          continue
        }
        if (!result.hits.length) continue
        hits.push(
          `# ${target.title} (${target.kind} · ${target.id})\n` +
            result.hits
              .map(
                (hit) =>
                  `- [${hit.chunk.id}] ${hit.chunk.label ?? hit.chunk.kind}: ${hit.chunk.text.slice(0, 400)}`
              )
              .join('\n')
        )
      }
      const text = hits.join('\n\n') || 'No matching passages in Knowledge.'
      return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
    }
  })

  const knowledgeFetch = defineTool({
    name: 'knowledge_fetch',
    label: TOOL_LABELS.knowledge_fetch,
    description:
      'Fetch full text for knowledge chunks by id (from knowledge_search), or the whole note markdown.',
    parameters: Type.Object({
      host_id: Type.String({ description: 'Knowledge host id.' }),
      ids: Type.Optional(
        Type.Array(Type.String(), { description: 'Chunk ids from knowledge_search (max 20).' })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval || !host.knowledge) return failure('Knowledge retrieval is unavailable')
      const hostId = String(params.host_id ?? '').trim()
      const knowledge = host.knowledge.get(hostId)
      if (!knowledge?.storedPath) return failure(`Unknown knowledge host ${hostId}`)
      if (knowledge.kind === 'note' && !params.ids?.length) {
        const note = host.knowledge.readNote(hostId)
        const text = note?.markdown ?? ''
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }
      const ids = Array.isArray(params.ids) ? params.ids.map(String).slice(0, 20) : []
      if (!ids.length) return failure('Pass ids from knowledge_search, or omit ids on a note to fetch the whole note')
      const result = await host.retrieval.fetch({ path: knowledge.storedPath, ids })
      const text =
        'error' in result && result.error
          ? result.error
          : result.chunks.map((chunk) => `## ${chunk.id}\n${chunk.text}`).join('\n\n')
      return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
    }
  })

  const knowledgeWrite = defineTool({
    name: 'knowledge_write',
    label: TOOL_LABELS.knowledge_write,
    description:
      'Replace the markdown of a Knowledge note. Always write the full note. Documents cannot be overwritten this way.',
    parameters: Type.Object({
      host_id: Type.String({ description: 'Note host id.' }),
      markdown: Type.String({ description: 'Full markdown contents.' })
    }),
    async execute(_id, params) {
      if (!host.knowledge) return failure('Knowledge store is unavailable')
      const hostId = String(params.host_id ?? '').trim()
      const knowledge = host.knowledge.get(hostId)
      if (!knowledge) return failure(`Unknown knowledge host ${hostId}`)
      if (knowledge.kind !== 'note') {
        return failure('knowledge_write is for notes only. Documents are ingested files.')
      }
      const note = host.knowledge.writeNote(hostId, String(params.markdown ?? ''))
      if (!note) return failure('Could not write note')
      host.knowledgeChanged?.()
      const text = `Updated note “${knowledge.title}” (${note.markdown.length} chars).`
      return { content: [{ type: 'text' as const, text }], details: { display: text } }
    }
  })

  return [knowledgeSearch, knowledgeFetch, knowledgeWrite] as const
}

export type KnowledgeToolHost = Pick<
  KnowledgeStore,
  'get' | 'readNote' | 'writeNote' | 'searchTargets'
>
