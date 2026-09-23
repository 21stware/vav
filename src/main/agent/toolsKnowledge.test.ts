import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { KnowledgeStore } from '../store/KnowledgeStore.ts'
import { createFsTools } from './toolsFs.ts'
import { createKnowledgeTools } from './toolsKnowledge.ts'
import type { ToolHost } from './toolHost.ts'

describe('knowledge_fetch', () => {
  it('defaults host_id to the open app-column note', async () => {
    const [, knowledgeFetch] = createKnowledgeTools({
      retrieval: {},
      knowledge: {
        get: (id: string) =>
          id === 'kh1'
            ? { id: 'kh1', title: 'Meeting', kind: 'note', storedPath: '/tmp/kh1.md' }
            : undefined,
        readNote: (id: string) =>
          id === 'kh1' ? { hostId: 'kh1', markdown: '# Meeting\n\nShip it.', updatedAt: 1 } : null,
        writeNote: () => null,
        searchTargets: () => []
      },
      defaultKnowledgeHostId: () => 'kh1'
    } as unknown as ToolHost)
    const result = await knowledgeFetch.execute('1', {}, new AbortController().signal, () => {})
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /Ship it/)
  })

  it('asks for a host when none is open', async () => {
    const [, knowledgeFetch] = createKnowledgeTools({
      retrieval: {},
      knowledge: {
        get: () => undefined,
        readNote: () => null,
        writeNote: () => null,
        searchTargets: () => []
      }
    } as unknown as ToolHost)
    const result = await knowledgeFetch.execute('1', {}, new AbortController().signal, () => {})
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /open a Knowledge note/)
  })
})

describe('note_write / note_edit', () => {
  it('creates a note in the app and edits it without a file path', async () => {
    let written = ''
    const host = {
      appResources: {
        create: async (input: { kind: string; content?: string; title?: string }) => {
          assert.equal(input.kind, 'knowledge')
          written = input.content ?? ''
          return { url: 'vav://app/knowledge?id=n1', title: input.title || 'Untitled' }
        }
      },
      knowledge: {
        get: (id: string) =>
          id === 'n1' ? { id: 'n1', title: 'Launch', kind: 'note', storedPath: '/vault/n1.md' } : undefined,
        readNote: () => null,
        writeNote: (_id: string, markdown: string) => {
          written = markdown
          return { hostId: 'n1', markdown, updatedAt: 2 }
        },
        searchTargets: () => []
      },
      defaultKnowledgeHostId: () => 'n1',
      knowledgeChanged: () => {}
    } as unknown as ToolHost
    const tools = createKnowledgeTools(host)
    const noteWrite = tools.find((tool) => tool.name === 'note_write')!
    const noteEdit = tools.find((tool) => tool.name === 'note_edit')!
    const created = await noteWrite.execute('1', { title: 'Launch', markdown: '# Launch\n\nShip.' }, undefined)
    const createdText = created.content[0] && 'text' in created.content[0] ? created.content[0].text : ''
    assert.match(createdText, /vav:\/\/app\/knowledge\?id=n1/)
    assert.match(written, /Ship/)
    const edited = await noteEdit.execute('2', { markdown: '# Launch\n\nDone.' }, undefined)
    const editedText = edited.content[0] && 'text' in edited.content[0] ? edited.content[0].text : ''
    assert.match(editedText, /vav:\/\/app\/knowledge\?id=n1/)
    assert.match(written, /Done/)
  })
})

describe('knowledge_library', () => {
  it('lists folders, files a note, refuses to delete All Notes, and merges', async () => {
    const knowledge = new KnowledgeStore(mkdtempSync(join(tmpdir(), 'vav-library-')))
    knowledge.load()
    const folder = knowledge.createFolder('Research')
    const keep = knowledge.createNote('Keep', 'c1')
    knowledge.writeNote(keep.id, '# Keep\n\none')
    const extra = knowledge.createNote('Extra', 'c2')
    knowledge.writeNote(extra.id, '# Extra\n\ntwo')
    const tools = createKnowledgeTools({
      knowledge,
      appResources: {
        remove: async (url: string) => {
          const id = url.match(/[?&]id=([^&]+)/)?.[1]
          if (!id || !knowledge.remove(id)) return { error: `missing ${url}` }
          return { ok: true as const, url }
        }
      },
      knowledgeChanged: () => {}
    } as unknown as ToolHost)
    const library = tools.find((tool) => tool.name === 'knowledge_library')!
    const listed = await library.execute('1', { op: 'list' }, undefined)
    const listedText = listed.content[0] && 'text' in listed.content[0] ? listed.content[0].text : ''
    assert.match(listedText, /All Notes/)
    assert.match(listedText, /Research/)
    assert.match(listedText, /cannot be deleted/)

    const refused = await library.execute('2', { op: 'delete_folder', folder_id: 'all' }, undefined)
    const refusedText = refused.content[0] && 'text' in refused.content[0] ? refused.content[0].text : ''
    assert.match(refusedText, /cannot be deleted/)

    await library.execute('3', { op: 'move', host_id: keep.id, folder_id: folder.id }, undefined)
    assert.equal(knowledge.get(keep.id)?.folderId, folder.id)

    const read = await library.execute('4', { op: 'read', folder_id: folder.id }, undefined)
    const readText = read.content[0] && 'text' in read.content[0] ? read.content[0].text : ''
    assert.match(readText, /one/)

    const merged = await library.execute(
      '5',
      { op: 'merge', into: keep.id, host_ids: [extra.id] },
      undefined
    )
    const mergedText = merged.content[0] && 'text' in merged.content[0] ? merged.content[0].text : ''
    assert.match(mergedText, /Merged 1/)
    assert.match(knowledge.readNote(keep.id)?.markdown ?? '', /two/)
    assert.equal(knowledge.get(extra.id), undefined)
  })
})

describe('fs_write notes', () => {
  it('refuses to overwrite a note vault file', async () => {
    const [, fsWrite] = createFsTools({
      workdir: '/tmp/proj',
      conversationId: 'c1',
      files: {
        workingCopies: { logicalPath: (path: string) => path },
        readTextFile: async () => ({ content: '', error: null, truncated: false }),
        writeTextFile: async () => {
          throw new Error('fs_write should not touch a note')
        }
      },
      knowledge: {
        searchTargets: () => [
          { id: 'n1', title: 'Launch', path: '/vault/n1.md', kind: 'note' }
        ]
      }
    } as unknown as ToolHost)
    const result = await fsWrite.execute(
      '1',
      { path: '/vault/n1.md', content: '# Launch\n\nvia file' },
      undefined
    )
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /note_edit/)
    assert.match(text, /does not write notes/)
  })

  it('refuses to overwrite a registered analysis file', async () => {
    const [, fsWrite] = createFsTools({
      workdir: '/tmp/proj',
      conversationId: 'c1',
      files: {
        workingCopies: { logicalPath: (path: string) => path },
        readTextFile: async () => ({ content: '', error: null, truncated: false }),
        writeTextFile: async () => {
          throw new Error('fs_write should not touch an analysis file')
        }
      },
      knowledge: { searchTargets: () => [] },
      appResources: {
        list: () => [{ url: 'vav://app/data?id=d1', kind: 'data', title: 'Sales', path: '/tmp/sales.csv' }]
      }
    } as unknown as ToolHost)
    const result = await fsWrite.execute(
      '1',
      { path: '/tmp/sales.csv', content: 'a,b\n1,2\n' },
      undefined
    )
    const text = result.content[0] && 'text' in result.content[0] ? result.content[0].text : ''
    assert.match(text, /analysis_edit/)
    assert.match(text, /does not write analysis/)
  })
})
