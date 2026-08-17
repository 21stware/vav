import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { mintSwarmCursor } from '../../shared/cliPaneBinding.ts'
import { SwarmHistoryStore } from './SwarmHistoryStore.ts'

describe('SwarmHistoryStore', () => {
  it('records a named session and keeps the name across title updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-swarm-history-'))
    const store = new SwarmHistoryStore(join(dir, 'history.json'))
    const cursor = mintSwarmCursor('grok', 'sess-1')!
    store.upsert({
      agentId: 'grok',
      cursor,
      conversationId: 'c1',
      workingDirectory: '/tmp/a',
      title: 'Host title'
    })
    store.rename('grok:sess-1', 'My pane')
    store.upsert({
      agentId: 'grok',
      cursor,
      conversationId: 'c1',
      workingDirectory: '/tmp/a',
      title: 'Newer host title'
    })
    const row = store.get('grok:sess-1')
    assert.equal(row?.name, 'My pane')
    assert.equal(row?.title, 'Newer host title')
    store.dispose()

    const reloaded = new SwarmHistoryStore(join(dir, 'history.json'))
    reloaded.load()
    assert.equal(reloaded.get('grok:sess-1')?.name, 'My pane')
    assert.equal(reloaded.get('grok:sess-1')?.title, 'Newer host title')
  })

  it('lists and removes records for one conversation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-swarm-history-'))
    const store = new SwarmHistoryStore(join(dir, 'history.json'))
    const a = mintSwarmCursor('grok', 'sess-a')!
    const b = mintSwarmCursor('claude', 'sess-b')!
    store.upsert({
      agentId: 'grok',
      cursor: a,
      conversationId: 'c1',
      workingDirectory: '/tmp/a',
      title: 'One'
    })
    store.upsert({
      agentId: 'claude',
      cursor: b,
      conversationId: 'c2',
      workingDirectory: '/tmp/b',
      title: 'Two'
    })
    assert.equal(store.forConversation('c1').length, 1)
    assert.equal(store.forConversation('c1')[0]?.key, 'grok:sess-a')
    assert.equal(store.remove('grok:sess-a'), true)
    assert.equal(store.remove('grok:sess-a'), false)
    assert.equal(store.forConversation('c1').length, 0)
    assert.equal(store.get('claude:sess-b')?.conversationId, 'c2')
    store.dispose()
  })
})
