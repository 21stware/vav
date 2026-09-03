import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildTrayPane } from './trayPane.ts'

const labels = {
  dirLabel: (dir: string) => `~${dir}`,
  agentLabel: (id: string) => (id === 'claude' ? 'Claude' : id),
  hostDisplayName: (host: string) => host.toUpperCase()
}

describe('buildTrayPane', () => {
  it('returns null for missing or archived conversations', () => {
    assert.equal(
      buildTrayPane({
        conversationId: 'c1',
        conversation: null,
        kind: 'chat',
        ...labels
      }),
      null
    )
    assert.equal(
      buildTrayPane({
        conversationId: 'c1',
        conversation: { archived: true, updatedAt: 1 },
        kind: 'chat',
        ...labels
      }),
      null
    )
  })

  it('fills chat / agent titles from the conversation and extras', () => {
    const chat = buildTrayPane({
      conversationId: 'c1',
      conversation: {
        title: '  Ship it  ',
        workingDirectory: '/proj',
        updatedAt: 9,
        cliHost: 'codex'
      },
      kind: 'chat',
      ...labels
    })
    assert.equal(chat?.sessionTitle, 'Ship it')
    assert.equal(chat?.paneTitle, 'CODEX')
    assert.equal(chat?.dirKey, '/proj')
    assert.equal(chat?.dirLabel, '~/proj')
    assert.equal(chat?.agentId, 'codex')

    const agent = buildTrayPane({
      conversationId: 'c1',
      conversation: { title: 'Ship it', workingDirectory: '/proj', updatedAt: 9 },
      kind: 'agent',
      extra: { tabId: 't1', agentId: 'claude', sessionTitle: 'leaf', createdAt: 3 },
      ...labels
    })
    assert.equal(agent?.paneTitle, 'Claude')
    assert.equal(agent?.tabId, 't1')
    assert.equal(agent?.sessionTitle, 'leaf')
    assert.equal(agent?.createdAt, 3)
  })
})
