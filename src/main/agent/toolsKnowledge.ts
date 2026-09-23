import { formatAppResourceUrl } from '@shared/appResourceUrl'
import { KNOWLEDGE_ALL_NOTES_ID } from '@shared/knowledge'
import { TOOL_LABELS } from '@shared/types'
import { Type, defineTool, failure, type ToolHost } from './toolHost'
import { cap } from './toolSummarize'
import type { KnowledgeStore } from '../store/KnowledgeStore'

function noteUrl(hostId: string): string {
  return formatAppResourceUrl({ kind: 'knowledge', id: hostId })
}

async function createAppNote(
  host: ToolHost,
  markdown: string,
  title: string | undefined,
  folderId?: string
) {
  if (!host.appResources) return failure('Cannot create a note (app catalog is unavailable)')
  const created = await host.appResources.create({
    kind: 'knowledge',
    content: markdown,
    title: title?.trim() || undefined,
    folderId: folderId?.trim() || undefined
  })
  if ('error' in created) return failure(created.error)
  const text = `Created note “${created.title}”\n${created.url}`
  return { content: [{ type: 'text' as const, text }], details: { display: text } }
}

function editAppNote(host: ToolHost, hostId: string, markdown: string) {
  if (!host.knowledge) return failure('Knowledge store is unavailable')
  const knowledge = host.knowledge.get(hostId)
  if (!knowledge) return failure(`Unknown note ${hostId}`)
  if (knowledge.kind !== 'note') {
    return failure('note_edit is for notes only. Documents are ingested files.')
  }
  const note = host.knowledge.writeNote(hostId, markdown)
  if (!note) return failure('Could not write note')
  host.knowledgeChanged?.()
  const text = `Updated note “${knowledge.title}”\n${noteUrl(hostId)}`
  return { content: [{ type: 'text' as const, text }], details: { display: text } }
}

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
          `# ${target.title}${target.folderName ? ` · ${target.folderName}` : ''} (${target.kind} · ${target.id})\n` +
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
      'Fetch full text for knowledge chunks by id (from knowledge_search), or the whole note markdown. host_id defaults to the open Knowledge item in the app column.',
    parameters: Type.Object({
      host_id: Type.Optional(
        Type.String({
          description:
            'Knowledge host id. Omit to use the note / document currently open in the app column.'
        })
      ),
      ids: Type.Optional(
        Type.Array(Type.String(), { description: 'Chunk ids from knowledge_search (max 20).' })
      )
    }),
    async execute(_id, params) {
      if (!host.retrieval || !host.knowledge) return failure('Knowledge retrieval is unavailable')
      const hostId =
        String(params.host_id ?? '').trim() || host.defaultKnowledgeHostId?.()?.trim() || ''
      if (!hostId) {
        return failure('Pass host_id, or open a Knowledge note in the app column')
      }
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
      'Compatibility alias for notes. Prefer `note_write` to create a note and `note_edit` to rewrite one. Omit host_id to create; pass host_id to replace the full markdown. Not a filesystem write.',
    parameters: Type.Object({
      host_id: Type.Optional(Type.String({ description: 'Note host id. Omit to create a new note.' })),
      title: Type.Optional(Type.String({ description: 'Title when creating a note.' })),
      folder_id: Type.Optional(
        Type.String({ description: 'Folder id when creating. Omit to leave the note unfiled under All Notes.' })
      ),
      markdown: Type.String({ description: 'Full markdown contents.' })
    }),
    async execute(_id, params) {
      const markdown = String(params.markdown ?? '')
      const hostId = String(params.host_id ?? '').trim()
      if (!hostId) {
        return createAppNote(host, markdown, String(params.title ?? ''), String(params.folder_id ?? ''))
      }
      return editAppNote(host, hostId, markdown)
    }
  })

  const noteWrite = defineTool({
    name: 'note_write',
    label: TOOL_LABELS.note_write,
    description:
      'Create a new Note in the app (笔记 / Knowledge). This is the Note output tool — not a file write. Pass title and the full markdown. Do not use fs_write, and do not put the note in the working directory.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Note title. A leading # heading in markdown is used when omitted.' })),
      folder_id: Type.Optional(
        Type.String({
          description: 'Folder id from knowledge_library. Omit to leave the note unfiled under All Notes.'
        })
      ),
      markdown: Type.String({ description: 'Full markdown contents of the new note.' })
    }),
    async execute(_id, params) {
      return createAppNote(
        host,
        String(params.markdown ?? ''),
        String(params.title ?? ''),
        String(params.folder_id ?? '')
      )
    }
  })

  const noteEdit = defineTool({
    name: 'note_edit',
    label: TOOL_LABELS.note_edit,
    description:
      'Replace the full markdown of an existing app Note (笔记). Pass host_id, or omit it to edit the note open in the app column. This is not fs_write and it does not create a file. Imported documents cannot be overwritten this way.',
    parameters: Type.Object({
      host_id: Type.Optional(
        Type.String({
          description: 'Note host id. Omit to edit the note currently open in the app column.'
        })
      ),
      markdown: Type.String({ description: 'Full markdown contents. This replaces the note.' })
    }),
    async execute(_id, params) {
      const hostId =
        String(params.host_id ?? '').trim() || host.defaultKnowledgeHostId?.()?.trim() || ''
      if (!hostId) return failure('Pass host_id, or open a note in the app column. To create a note, use note_write.')
      return editAppNote(host, hostId, String(params.markdown ?? ''))
    }
  })

  const knowledgeLibrary = defineTool({
    name: 'knowledge_library',
    label: TOOL_LABELS.knowledge_library,
    description:
      'Read and organize the Notes library. All Notes is the undeletable root (folder id "all") and lists every note. User folders are subsets. ops: list (folders + notes), read (markdown in a folder), create_folder, rename_folder, delete_folder (notes become unfiled, not deleted), move (host_ids into folder_id; omit folder_id or pass "all" to unfile), merge (append host_ids into `into`, then remove the sources). Use knowledge_fetch for one note and note_write / note_edit to create or rewrite.',
    parameters: Type.Object({
      op: Type.String({
        description: 'list | read | create_folder | rename_folder | delete_folder | move | merge'
      }),
      folder_id: Type.Optional(
        Type.String({
          description: 'Folder id. "all" is All Notes. move: destination. read: which folder to dump.'
        })
      ),
      name: Type.Optional(Type.String({ description: 'create_folder / rename_folder: folder name.' })),
      host_id: Type.Optional(Type.String({ description: 'move: one note or document id.' })),
      host_ids: Type.Optional(
        Type.Array(Type.String(), {
          description: 'move: ids to file. merge: notes appended into `into` and then removed.'
        })
      ),
      into: Type.Optional(Type.String({ description: 'merge: target note id. Sources are removed after append.' }))
    }),
    async execute(_id, params) {
      if (!host.knowledge) return failure('Knowledge store is unavailable')
      const op = String(params.op ?? '').trim().toLowerCase()
      const knowledge = host.knowledge
      if (op === 'list') {
        const text = formatLibrary(knowledge)
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }
      if (op === 'read') {
        const text = readLibraryFolder(knowledge, String(params.folder_id ?? ''))
        if (!text) return failure(`Unknown folder ${String(params.folder_id ?? '')}`)
        return { content: [{ type: 'text' as const, text: cap(text) }], details: { display: text } }
      }
      if (op === 'create_folder') {
        const name = String(params.name ?? '').trim()
        if (!name) return failure('create_folder needs name')
        const folder = knowledge.createFolder(name)
        host.knowledgeChanged?.()
        const text = `Created folder “${folder.name}” (${folder.id}).`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }
      if (op === 'rename_folder') {
        const id = String(params.folder_id ?? '').trim()
        if (!id || id === KNOWLEDGE_ALL_NOTES_ID) return failure('All Notes cannot be renamed')
        const folder = knowledge.renameFolder(id, String(params.name ?? ''))
        if (!folder) return failure(`Unknown folder ${id}`)
        host.knowledgeChanged?.()
        const text = `Renamed folder to “${folder.name}” (${folder.id}).`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }
      if (op === 'delete_folder') {
        const id = String(params.folder_id ?? '').trim()
        if (!id || id === KNOWLEDGE_ALL_NOTES_ID) return failure('All Notes cannot be deleted')
        if (!knowledge.removeFolder(id)) return failure(`Unknown folder ${id}`)
        host.knowledgeChanged?.()
        const text = `Deleted folder ${id}. Its notes are still in All Notes.`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }
      if (op === 'move') {
        const ids = hostIdsFrom(params)
        if (!ids.length) return failure('move needs host_id or host_ids')
        const requested = String(params.folder_id ?? '').trim()
        const folderId = !requested || requested === KNOWLEDGE_ALL_NOTES_ID ? null : requested
        if (folderId && !knowledge.getFolder(folderId)) return failure(`Unknown folder ${folderId}`)
        const moved = knowledge.moveToFolder(ids, folderId)
        if (!moved) return failure(`Unknown folder ${requested}`)
        host.knowledgeChanged?.()
        const where = folderId ? knowledge.getFolder(folderId)?.name ?? folderId : 'All Notes'
        const text = moved.length
          ? `Moved ${moved.length} into ${where}.`
          : `Already in ${where}.`
        return { content: [{ type: 'text' as const, text }], details: { display: text } }
      }
      if (op === 'merge') {
        return mergeNotes(host, String(params.into ?? '').trim(), hostIdsFrom(params))
      }
      return failure('op must be list, read, create_folder, rename_folder, delete_folder, move, or merge')
    }
  })

  return [knowledgeSearch, knowledgeFetch, knowledgeWrite, noteWrite, noteEdit, knowledgeLibrary] as const
}

const LIBRARY_MUTATIONS = new Set(['create_folder', 'rename_folder', 'delete_folder', 'move', 'merge'])

export function knowledgeLibraryOpFromArgs(name: string, args: unknown): string {
  if (name !== 'knowledge_library' || !args || typeof args !== 'object' || !('op' in args)) return ''
  return String((args as { op: unknown }).op ?? '')
    .trim()
    .toLowerCase()
}

export function isKnowledgeLibraryMutatingOp(op: string): boolean {
  return LIBRARY_MUTATIONS.has(op)
}

function hostIdsFrom(params: { host_id?: string; host_ids?: string[] }): string[] {
  const many = Array.isArray(params.host_ids) ? params.host_ids.map(String) : []
  const one = String(params.host_id ?? '').trim()
  return [...new Set([...many, one].map((id) => id.trim()).filter(Boolean))]
}

function formatLibrary(knowledge: KnowledgeToolHost): string {
  const folders = knowledge.listFolders()
  const hosts = knowledge.list()
  const lines = [
    '# Folders',
    `- All Notes (id ${KNOWLEDGE_ALL_NOTES_ID}, cannot be deleted) — ${hosts.length}`
  ]
  for (const folder of folders) {
    const count = hosts.filter((row) => row.folderId === folder.id).length
    lines.push(`- ${folder.name} (id ${folder.id}) — ${count}`)
  }
  lines.push('', '# Notes and documents')
  if (!hosts.length) lines.push('(empty)')
  for (const row of hosts) {
    const folder = row.folderId
      ? (folders.find((item) => item.id === row.folderId)?.name ?? row.folderId)
      : 'All Notes'
    lines.push(`- ${row.title} (${row.kind} · folder ${folder} · ${row.id})`)
    lines.push(`  ${noteUrl(row.id)}`)
  }
  return lines.join('\n')
}

function readLibraryFolder(knowledge: KnowledgeToolHost, folderId: string): string | null {
  const requested = folderId.trim()
  const all = !requested || requested === KNOWLEDGE_ALL_NOTES_ID
  if (!all && !knowledge.getFolder(requested)) return null
  const folderName = all ? 'All Notes' : knowledge.getFolder(requested)?.name ?? requested
  const hosts = knowledge.list().filter((row) => all || row.folderId === requested)
  if (!hosts.length) return `# ${folderName}\n\nThis folder is empty.`
  const parts = [`# ${folderName}`]
  for (const row of hosts) {
    if (row.kind === 'note') {
      const note = knowledge.readNote(row.id)
      parts.push(`## ${row.title}\n${noteUrl(row.id)}\n\n${note?.markdown ?? ''}`)
    } else {
      parts.push(
        `## ${row.title} (document)\n${noteUrl(row.id)}\nUse knowledge_fetch host_id "${row.id}" for its chunks.`
      )
    }
  }
  return parts.join('\n\n')
}

async function mergeNotes(
  host: ToolHost,
  intoId: string,
  sourceIds: string[]
): Promise<{ content: [{ type: 'text'; text: string }]; details: { display: string } }> {
  const knowledge = host.knowledge
  if (!knowledge) return failure('Knowledge store is unavailable')
  if (!intoId) return failure('merge needs into (the note that keeps the text)')
  const target = knowledge.get(intoId)
  if (!target) return failure(`Unknown note ${intoId}`)
  if (target.kind !== 'note') return failure('merge target must be a note')
  const sources = sourceIds.filter((id) => id !== intoId)
  if (!sources.length) return failure('merge needs host_ids besides into')
  let markdown = knowledge.readNote(intoId)?.markdown ?? ''
  const removed: string[] = []
  for (const id of sources) {
    const row = knowledge.get(id)
    if (!row) return failure(`Unknown note ${id}`)
    if (row.kind !== 'note') return failure(`“${row.title}” is a document and cannot be merged`)
    const body = knowledge.readNote(id)?.markdown.trim()
    if (body) markdown = `${markdown.replace(/\s+$/, '')}\n\n${body}\n`
    removed.push(row.title)
  }
  if (!knowledge.writeNote(intoId, markdown)) return failure('Could not write the merged note')
  for (const id of sources) {
    const url = noteUrl(id)
    if (host.appResources) {
      const result = await host.appResources.remove(url)
      if ('error' in result) return failure(result.error)
    } else if (!knowledge.remove(id)) {
      return failure(`Could not remove ${id}`)
    }
  }
  host.knowledgeChanged?.()
  const title = knowledge.get(intoId)?.title ?? target.title
  const text = `Merged ${removed.length} into “${title}” and removed ${removed.join(', ')}.\n${noteUrl(intoId)}`
  return { content: [{ type: 'text', text }], details: { display: text } }
}

export type KnowledgeToolHost = Pick<
  KnowledgeStore,
  | 'get'
  | 'list'
  | 'listFolders'
  | 'getFolder'
  | 'readNote'
  | 'writeNote'
  | 'remove'
  | 'searchTargets'
  | 'createFolder'
  | 'renameFolder'
  | 'removeFolder'
  | 'moveToFolder'
>
