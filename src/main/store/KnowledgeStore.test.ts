import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { knowledgeNotePreview } from '../../shared/knowledge.ts'
import { KnowledgeStore } from './KnowledgeStore.ts'

function store(): KnowledgeStore {
  const next = new KnowledgeStore(mkdtempSync(join(tmpdir(), 'vav-knowledge-')))
  next.load()
  return next
}

describe('KnowledgeStore note titles', () => {
  it('renames the host and the leading heading together', () => {
    const knowledge = store()
    const note = knowledge.createNote('', 'conv-1')
    assert.equal(note.title, 'Untitled note')
    assert.match(readFileSync(note.storedPath!, 'utf8'), /^# Untitled note/)

    const renamed = knowledge.rename(note.id, 'Launch plan')
    assert.equal(renamed?.title, 'Launch plan')
    assert.equal(readFileSync(note.storedPath!, 'utf8'), '# Launch plan\n\n')
    assert.equal(knowledge.readNote(note.id)?.markdown.startsWith('# Launch plan'), true)
  })

  it('keeps a body when the title changes', () => {
    const knowledge = store()
    const note = knowledge.createNote('Notes', null)
    knowledge.writeNote(note.id, '# Notes\n\nhello')
    knowledge.rename(note.id, 'Plan')
    assert.equal(knowledge.readNote(note.id)?.markdown, '# Plan\n\nhello')
    assert.equal(knowledge.get(note.id)?.title, 'Plan')
  })
})

describe('knowledgeNotePreview', () => {
  it('skips the title and keeps the first line of the body', () => {
    assert.equal(knowledgeNotePreview('# Launch\n\nShip the beta next week.'), 'Ship the beta next week.')
    assert.equal(knowledgeNotePreview('# Only'), '')
  })
})

describe('KnowledgeStore folders', () => {
  it('files notes, renames folders, and unfiles notes when a folder is deleted', () => {
    const knowledge = store()
    const folder = knowledge.createFolder('Research')
    const note = knowledge.createNote('Plan', null, 1, folder.id)
    const loose = knowledge.createNote('Loose', null)
    assert.equal(note.folderId, folder.id)
    assert.equal(loose.folderId, null)
    assert.equal(knowledge.renameFolder(folder.id, 'Launch')?.name, 'Launch')
    assert.equal(knowledge.renameFolder('all', 'Nope'), null)
    assert.equal(knowledge.removeFolder('all'), false)
    assert.equal(knowledge.moveToFolder([loose.id], folder.id)?.[0]?.folderId, folder.id)
    assert.equal(knowledge.moveToFolder([note.id], 'missing'), null)
    assert.equal(knowledge.removeFolder(folder.id), true)
    assert.equal(knowledge.get(note.id)?.folderId, null)
    assert.equal(knowledge.get(loose.id)?.folderId, null)
    assert.equal(knowledge.listFolders().length, 0)
  })

  it('reads a legacy host array as unfiled notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-knowledge-legacy-'))
    const knowledgeDir = join(dir, 'knowledge')
    mkdirSync(knowledgeDir, { recursive: true })
    writeFileSync(
      join(knowledgeDir, 'index.json'),
      JSON.stringify([
        {
          id: 'n1',
          title: 'Old',
          kind: 'note',
          sourcePath: null,
          storedPath: null,
          conversationId: null,
          chunkCount: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    )
    const knowledge = new KnowledgeStore(dir)
    knowledge.load()
    assert.equal(knowledge.get('n1')?.title, 'Old')
    assert.equal(knowledge.get('n1')?.folderId, null)
    assert.deepEqual(knowledge.listFolders(), [])
  })
})

describe('KnowledgeStore vault location', () => {
  it('exposes the vault root and migrates a legacy userData copy', () => {
    const legacyHome = mkdtempSync(join(tmpdir(), 'vav-knowledge-legacy-'))
    const nextHome = mkdtempSync(join(tmpdir(), 'vav-knowledge-next-'))
    try {
      const legacy = new KnowledgeStore(legacyHome)
      legacy.load()
      const note = legacy.createNote('Migrated', 'c1')
      legacy.writeNote(note.id, '# Migrated\n\nhello')

      const next = new KnowledgeStore(nextHome, { migrateFrom: legacyHome })
      next.load()
      assert.equal(next.rootDir, join(nextHome, 'knowledge'))
      const moved = next.list()[0]
      assert.equal(moved?.title, 'Migrated')
      assert.equal(moved?.storedPath?.startsWith(next.rootDir), true)
      assert.equal(next.readNote(moved!.id)?.markdown.includes('hello'), true)
    } finally {
      rmSync(legacyHome, { recursive: true, force: true })
      rmSync(nextHome, { recursive: true, force: true })
    }
  })

  it('picks up a note written by a sibling store on the same vault', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-knowledge-share-'))
    try {
      const writer = new KnowledgeStore(dir)
      writer.load()
      const reader = new KnowledgeStore(dir)
      reader.load()
      const note = writer.createNote('Shared', null)
      writer.writeNote(note.id, '# Shared\n\nfrom writer')
      assert.equal(reader.get(note.id)?.title, 'Shared')
      assert.match(reader.readNote(note.id)?.markdown ?? '', /from writer/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
