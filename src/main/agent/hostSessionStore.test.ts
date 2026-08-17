import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  discoverHostSession,
  encodeClaudeProjectDir,
  encodeGrokSessionDir,
  hostSessionExists,
  hostSessionHasConversation,
  listHostSessions,
  readHostSessionTitle
} from './hostSessionStore.ts'

describe('hostSessionStore', () => {
  const cwd = '/Users/oboo/repo/vav'

  it('encodes Claude / Grok project dirs the way those CLIs do', () => {
    assert.equal(encodeClaudeProjectDir(cwd), '-Users-oboo-repo-vav')
    assert.equal(encodeGrokSessionDir(cwd), encodeURIComponent(cwd))
  })

  it('reads Grok generated_title and discovers a new session in that cwd', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const id = '01a00d68-3e27-7ac2-a775-92e5116eb68a'
    const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({ generated_title: 'Read Swarm Agent Session Titles' })
    )
    assert.equal(readHostSessionTitle('grok', id, cwd, { home }), 'Read Swarm Agent Session Titles')
    assert.equal(hostSessionExists('grok', id, cwd, { home }), true)
    assert.equal(hostSessionExists('grok', 'missing-id', cwd, { home }), false)
    const found = discoverHostSession('grok', cwd, { afterMs: 0, excludeIds: [], home })
    assert.equal(found?.id, id)
    assert.equal(found?.title, 'Read Swarm Agent Session Titles')
    const skipped = discoverHostSession('grok', cwd, { afterMs: 0, excludeIds: [id], home })
    assert.equal(skipped, null)
    const listed = listHostSessions('grok', cwd, { home })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, id)
    assert.equal(listed[0]?.title, 'Read Swarm Agent Session Titles')
    assert.equal(hostSessionHasConversation('grok', id, cwd, { home }), true)
  })

  it('treats a Grok spawn with only synthetic chat as empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const id = '019feedb-b143-79c0-aa63-7a10dd3029e4'
    const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({ info: { id }, session_summary: '', num_chat_messages: 2 })
    )
    writeFileSync(
      join(dir, 'chat_history.jsonl'),
      [
        JSON.stringify({ type: 'system', content: 'You are Grok' }),
        JSON.stringify({ type: 'user', content: 'setup', synthetic_reason: 'init' })
      ].join('\n')
    )
    assert.equal(readHostSessionTitle('grok', id, cwd, { home }), null)
    assert.equal(hostSessionHasConversation('grok', id, cwd, { home }), false)
  })

  it('reads the last Claude ai-title from jsonl', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const id = 'dd9fa826-d5af-4b11-a044-a6c3dbe718bc'
    const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${id}.jsonl`),
      [
        JSON.stringify({ type: 'user' }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'Review tsconfig.json configuration' }),
        JSON.stringify({ type: 'assistant' })
      ].join('\n')
    )
    assert.equal(
      readHostSessionTitle('claude', id, cwd, { home }),
      'Review tsconfig.json configuration'
    )
  })

  it('matches Codex session_index thread_name and cwd from rollout meta', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const id = '019ff3fa-b168-7931-a9b7-df40dc333254'
    mkdirSync(join(home, '.codex', 'sessions', '2026', '08', '12'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'session_index.jsonl'),
      JSON.stringify({ id, thread_name: '实现频道播放 Mock' }) + '\n'
    )
    writeFileSync(
      join(home, '.codex', 'sessions', '2026', '08', '12', `rollout-${id}.jsonl`),
      JSON.stringify({
        type: 'session_meta',
        payload: { session_id: id, cwd }
      }) + '\n'
    )
    assert.equal(readHostSessionTitle('codex', id, cwd, { home }), '实现频道播放 Mock')
    const found = discoverHostSession('codex', cwd, { afterMs: 0, excludeIds: [], home })
    assert.equal(found?.id, id)
    assert.equal(found?.title, '实现频道播放 Mock')
    assert.equal(
      discoverHostSession('codex', '/other', { afterMs: 0, excludeIds: [], home }),
      null
    )
  })

  it('reads OpenCode titles from sqlite and discovers by cwd', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const dir = join(home, '.local', 'share', 'opencode')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'opencode.db'))
    db.exec(`
      CREATE TABLE session (
        id TEXT, parent_id TEXT, slug TEXT, directory TEXT, title TEXT,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER
      )
    `)
    db.prepare(
      `INSERT INTO session (id, parent_id, slug, directory, title, time_created, time_updated, time_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'ses_ff21de2aaffeTjaaD6spWnp9gb',
      null,
      'kind-sailor',
      cwd,
      'openship 仓库分析',
      1_000,
      2_000,
      null
    )
    db.prepare(
      `INSERT INTO session (id, parent_id, slug, directory, title, time_created, time_updated, time_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ses_child', 'ses_parent', 'child', cwd, 'subagent', 3_000, 4_000, null)
    db.close()

    assert.equal(
      readHostSessionTitle('opencode', 'ses_ff21de2aaffeTjaaD6spWnp9gb', cwd, { home }),
      'openship 仓库分析'
    )
    const found = discoverHostSession('opencode', cwd, { afterMs: 0, excludeIds: [], home })
    assert.equal(found?.id, 'ses_ff21de2aaffeTjaaD6spWnp9gb')
    assert.equal(found?.title, 'openship 仓库分析')
    assert.equal(
      discoverHostSession('opencode', cwd, {
        afterMs: 0,
        excludeIds: ['ses_ff21de2aaffeTjaaD6spWnp9gb'],
        home
      }),
      null
    )
  })

  it('reads Cursor acp-session meta titles', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const id = 'a74a9097-651d-4667-8219-2213de23cbdf'
    const dir = join(home, '.cursor', 'acp-sessions', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ cwd, title: 'Health Map Modeler' }))
    assert.equal(readHostSessionTitle('cursor', id, cwd, { home }), 'Health Map Modeler')
    const found = discoverHostSession('cursor', cwd, { afterMs: 0, excludeIds: [], home })
    assert.equal(found?.id, id)
  })

  it('prefers Cursor TUI chats over acp-sessions for the same cwd', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-host-session-'))
    const chatId = '724ae9f8-cdd5-458e-b697-a55a7cca39c8'
    const chatDir = join(home, '.cursor', 'chats', 'projhash', chatId)
    mkdirSync(chatDir, { recursive: true })
    writeFileSync(
      join(chatDir, 'meta.json'),
      JSON.stringify({
        cwd,
        title: 'Config UI Review',
        hasConversation: true,
        createdAtMs: 1_000,
        updatedAtMs: 9_000
      })
    )
    const acpDir = join(home, '.cursor', 'acp-sessions', 'acp-only')
    mkdirSync(acpDir, { recursive: true })
    writeFileSync(join(acpDir, 'meta.json'), JSON.stringify({ cwd, title: 'ACP leftover' }))
    assert.equal(readHostSessionTitle('cursor', chatId, cwd, { home }), 'Config UI Review')
    assert.equal(hostSessionExists('cursor', chatId, cwd, { home }), true)
    const found = discoverHostSession('cursor', cwd, { afterMs: 0, excludeIds: [], home })
    assert.equal(found?.id, chatId)
    assert.equal(found?.title, 'Config UI Review')
  })
})
