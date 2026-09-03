import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { conversationToMeta } from './conversationMeta.ts'
import type { Conversation } from '../../shared/types.ts'

describe('conversationToMeta', () => {
  it('drops messages, parked transcripts, and pane bindings', () => {
    const conversation = {
      id: 'c1',
      title: 'Hello',
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: '/tmp',
      model: 'm',
      tokensUsed: 0,
      tokenLimit: 1,
      pinned: false,
      pinTime: null,
      duplicateSourceId: null,
      duplicateSourceTitle: null,
      archived: false,
      archivedAt: null,
      approvalMode: 'auto',
      messages: [{ id: 'm1' }],
      activeLeafId: 'm1',
      tokenHistory: [{ timestamp: 1 }],
      cacheCreatedAt: 9,
      cacheExpiresAt: 10,
      compactions: [{ leafId: 'm1' }],
      hostTranscripts: { claude: { messages: [{ id: 'parked' }] } },
      quotaWindows: [{ id: 'five_hour' }],
      cliPaneBindings: { tab: { agentId: 'claude' } }
    } as unknown as Conversation
    const meta = conversationToMeta(conversation)
    assert.equal(meta.id, 'c1')
    assert.equal(meta.title, 'Hello')
    assert.equal('messages' in meta, false)
    assert.equal('tokenHistory' in meta, false)
    assert.equal('hostTranscripts' in meta, false)
    assert.equal('cliPaneBindings' in meta, false)
    assert.equal('quotaWindows' in meta, false)
    assert.equal('compactions' in meta, false)
  })
})
