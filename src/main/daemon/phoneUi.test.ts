import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderBlock, renderSessionRows, turnHtml } from '../../../extension/lib/ui/render.js'

describe('shared phone UI (desktop agent log)', () => {
  it('renders You / Agent labels, not chat bubbles', () => {
    assert.match(turnHtml('user', 'hi'), /message-role">You/)
    assert.match(turnHtml('assistant', 'ok'), /message-role">Agent/)
    assert.match(turnHtml('assistant', 'ok'), /data-testid="message-assistant"/)
  })

  it('renders tool cards and thinking like desktop', () => {
    const tool = renderBlock({ kind: 'tool', tool: 'fs_read', name: 'Read file', summary: 'hello.md' })
    assert.match(tool, /tool-call/)
    assert.match(tool, /data-testid="tool-card"/)
    assert.match(tool, /data-tool="fs_read"/)
    const think = renderBlock({ kind: 'reasoning', text: 'ponder' })
    assert.match(think, /thinking-process/)
    assert.match(think, /Thinking process/)
  })

  it('lists sessions with the desktop row contract', () => {
    const html = renderSessionRows(
      [{ id: 'a', title: 'One', dirLabel: 'Workspace', pinned: true }],
      'a'
    )
    assert.match(html, /data-testid="session-row"/)
    assert.match(html, /data-conversation-id="a"/)
    assert.match(html, /Pinned/)
    assert.match(html, /class="session-row active"/)
  })
})
