import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSystemPrompt,
  formatDbSchemaForPrompt,
  formatOutputDestinationForPrompt,
  osDisplayName
} from './systemPrompt.ts'

describe('osDisplayName', () => {
  it('maps known platforms', () => {
    assert.equal(osDisplayName('darwin'), 'macOS')
    assert.equal(osDisplayName('win32'), 'Windows')
    assert.equal(osDisplayName('linux'), 'Linux')
    assert.equal(osDisplayName('freebsd'), 'freebsd')
  })
})

describe('buildSystemPrompt', () => {
  it('names the injected platform and shell', () => {
    const prompt = buildSystemPrompt('/tmp/proj', 'zsh', { platform: 'darwin' })
    assert.match(prompt, /You are VAV, a local coding agent running on the user's macOS machine/)
    assert.match(prompt, /macOS machine/)
    assert.match(prompt, /working directory for this conversation is: \/tmp\/proj/)
    assert.match(prompt, /user's shell is zsh/)
    assert.match(prompt, /<!-- vav-artifact -->/)
    assert.match(prompt, /## Where output goes/)
    assert.match(prompt, /记成笔记/)
    const dest = formatOutputDestinationForPrompt()
    const appAt = dest.indexOf('1. App services')
    const artifactAt = dest.indexOf('2. Artifacts')
    const fileAt = dest.indexOf('3. Files')
    assert.ok(appAt >= 0 && artifactAt > appAt && fileAt > artifactAt)
    assert.match(dest, /do not `fs_write` a `\.md`/)
    assert.match(dest, /note_write/)
    assert.match(dest, /note_edit/)
    assert.match(prompt, /`note_write` \/ `note_edit`/)
    assert.match(prompt, /`analysis_write` \/ `analysis_edit`/)
    assert.match(prompt, /`schedule_write` \/ `schedule_edit`/)
    assert.match(prompt, /`storage_write` \/ `storage_edit`/)
    assert.match(prompt, /`app` — list, get, search, or delete Storage/)
    assert.match(prompt, /vav:\/\/app/)
    assert.match(prompt, /## App column/)
    assert.match(prompt, /op: create/)
    assert.match(prompt, /Scheduled/)
    assert.doesNotMatch(prompt, /READ-ONLY SESSION/)
  })

  it('adds read-only and open-file guidance', () => {
    const ro = buildSystemPrompt('/w', 'bash', {
      platform: 'linux',
      fileReadOnly: true,
      openFilePath: '/w/notes.md',
      skillCatalog: 'officecli'
    })
    assert.match(ro, /Linux machine/)
    assert.match(ro, /READ-ONLY SESSION/)
    assert.match(ro, /viewing this file in the preview: \/w\/notes\.md/)
    assert.match(ro, /Bundled catalog:\nofficecli/)
    const pdf = buildSystemPrompt('/w', 'bash', {
      platform: 'win32',
      openFilePath: '/w/a.pdf',
      openFileKind: 'pdf'
    })
    assert.match(pdf, /Windows machine/)
    assert.match(pdf, /load_skill\("pdf"\)/)
  })

  it('names the live database dialect', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'ClickHouse'
    })
    assert.match(prompt, /live ClickHouse database/)
    assert.match(prompt, /sql_query/)
  })

  it('names the open table so "this table" is grounded', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'PostgreSQL',
      dbTitle: 'pfmegrnargs@hh-pgsql-public.ebi.ac.uk',
      dbTable: 'rnacen.xref',
      dbSchema: [
        { name: 'rnacen.xref', columns: ['upi', 'ac'], rowCount: 12 },
        { name: 'rnc_database', columns: ['id'], rowCount: 3 }
      ]
    })
    assert.match(prompt, /pfmegrnargs@hh-pgsql-public\.ebi\.ac\.uk/)
    assert.match(prompt, /rnacen\.xref/)
    assert.match(prompt, /this table/)
    assert.match(prompt, /Catalog: 2 table\(s\)/)
    assert.match(prompt, /upi, ac/)
    assert.match(prompt, /rnc_database/)
  })

  it('says no table is focused when the preview has none', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'PostgreSQL',
      dbTitle: 'pfmegrnargs@host'
    })
    assert.match(prompt, /No table is focused/)
    assert.doesNotMatch(prompt, /Current preview table/)
  })

  it('formats a catalog snapshot with the current table', () => {
    const text = formatDbSchemaForPrompt(
      [
        { name: 'orders', columns: ['id', 'total'], rowCount: 40 },
        { name: 'empty', columns: [], rowCount: 0 }
      ],
      'orders'
    )
    assert.match(text, /Catalog: 2 table\(s\)/)
    assert.match(text, /`orders` \(~40 rows\): id, total/)
    assert.match(text, /`empty`/)
    assert.match(text, /Current preview table: `orders`/)
  })

  it('describes computer use only when the driver is up', () => {
    const off = buildSystemPrompt('/w', 'zsh', { platform: 'darwin' })
    assert.doesNotMatch(off, /computer_list/)
    const on = buildSystemPrompt('/w', 'zsh', { platform: 'darwin', computerUse: true })
    assert.match(on, /computer_list/)
    assert.match(on, /background/)
    assert.match(on, /computer-use/)
  })

  it('names the open app column so "this dataset" is grounded', () => {
    const prompt = buildSystemPrompt('/empty', 'zsh', {
      platform: 'darwin',
      appColumnFocus: {
        kind: 'data',
        level: 'item',
        title: 'sakila.db · actor',
        path: '/tmp/sakila.db',
        objectId: 'db1',
        url: 'vav://app/data?id=db1&path=%2Ftmp%2Fsakila.db',
        table: 'actor'
      },
      dbSession: true,
      dataFilePath: '/tmp/sakila.db',
      dbTable: 'actor'
    })
    assert.match(prompt, /Current app column: Data/)
    assert.match(prompt, /`actor`/)
    assert.match(prompt, /当前这个数据集/)
    assert.match(prompt, /Do not search the working directory/)
    assert.match(prompt, /You are on the Data page/)
    assert.match(prompt, /op: create/)
    assert.match(prompt, /Do not list catalogs/)
  })

  it('names the open knowledge note and host so "this note" is grounded', () => {
    const prompt = buildSystemPrompt('/empty', 'zsh', {
      platform: 'darwin',
      appColumnFocus: {
        kind: 'knowledge',
        level: 'item',
        title: 'Meeting notes',
        path: '/tmp/notes/kh1.md',
        objectId: 'n1',
        url: 'vav://app/knowledge?id=kh1&path=%2Ftmp%2Fnotes%2Fkh1.md'
      },
      knowledgeHost: {
        id: 'kh1',
        title: 'Meeting notes',
        kind: 'note',
        path: '/tmp/notes/kh1.md'
      }
    })
    assert.match(prompt, /Current app column: Knowledge/)
    assert.match(prompt, /这篇笔记/)
    assert.match(prompt, /Knowledge host id: kh1/)
    assert.match(prompt, /You are on the Knowledge page/)
    assert.match(prompt, /Do not `app list`/)
    assert.match(prompt, /attached to a Knowledge host: Meeting notes/)
  })

  it('lists session secret names without values', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      sessionSecretNames: ['OPENAI_API_KEY', 'GH_TOKEN']
    })
    assert.match(prompt, /request_for_secret/)
    assert.match(prompt, /OPENAI_API_KEY, GH_TOKEN/)
    assert.doesNotMatch(prompt, /sk-/)
  })
})
