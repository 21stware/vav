import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WEB_PREVIEW_CHAT_ID,
  activeIdForScene,
  conversationsForScene,
  parseWebPreviewScene,
  previewConversation
} from './scenes.ts'

describe('web preview scenes', () => {
  it('reads scene from a query string and defaults to chat', () => {
    assert.equal(parseWebPreviewScene(''), 'chat')
    assert.equal(parseWebPreviewScene('?theme=dark'), 'chat')
    assert.equal(parseWebPreviewScene('?scene=home'), 'home')
    assert.equal(parseWebPreviewScene('scene=empty'), 'empty')
    assert.equal(parseWebPreviewScene('?scene=settings&theme=light'), 'settings')
    assert.equal(parseWebPreviewScene('?scene=nope'), 'chat')
  })

  it('keeps home/empty without a workspace session so WorkbenchHome can paint', () => {
    assert.equal(activeIdForScene('chat'), WEB_PREVIEW_CHAT_ID)
    assert.equal(activeIdForScene('home'), '')
    assert.equal(activeIdForScene('empty'), '')
    assert.equal(
      conversationsForScene('chat').some((row) => row.id === WEB_PREVIEW_CHAT_ID),
      true
    )
    assert.equal(
      conversationsForScene('home').every((row) => row.sessionKind === 'file'),
      true
    )
    assert.equal(conversationsForScene('empty').length, 0)
  })

  it('seeds a two-turn transcript on the chat fixture', () => {
    const conversation = previewConversation()
    assert.equal(conversation.messages.length, 4)
    assert.equal(conversation.messages[0]?.role, 'user')
    assert.equal(conversation.messages[1]?.role, 'assistant')
    assert.equal(conversation.messages[2]?.role, 'user')
    assert.equal(conversation.messages[3]?.role, 'assistant')
    assert.equal(conversation.activeLeafId, conversation.messages[3]?.id)
    const kinds = conversation.messages[1]?.blocks.map((block) =>
      block.kind === 'toolCall' ? block.tool : block.kind
    )
    assert.deepEqual(kinds, ['reasoning', 'fs_read', 'reasoning', 'fs_write', 'text'])
  })
})
