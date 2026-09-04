import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeSendText, formatPageContext, isAttachablePage } from './chromePageContext.ts'

describe('chromePageContext', () => {
  it('formats a tab snapshot the agent can read', () => {
    const text = formatPageContext({
      url: 'https://example.com/docs',
      title: 'Install guide',
      siteName: 'Example',
      description: 'How to install',
      headings: ['Prereqs', 'Install'],
      selection: 'npm i -g @21stware/vavd',
      excerpt: 'Longer page body that is not the selection.'
    })
    assert.match(text, /\[Current page\]/)
    assert.match(text, /Title: Install guide/)
    assert.match(text, /URL: https:\/\/example.com\/docs/)
    assert.match(text, /Selected text:\nnpm i -g @21stware\/vavd/)
    assert.match(text, /Page text:\nLonger page body/)
  })

  it('composes the user ask above the page block', () => {
    const text = composeSendText('summarize this', {
      url: 'https://example.com',
      title: 'Example'
    })
    assert.ok(text.startsWith('summarize this'))
    assert.match(text, /URL: https:\/\/example.com/)
  })

  it('ignores chrome-extension and about pages', () => {
    assert.equal(isAttachablePage({ url: 'chrome-extension://abc/sidepanel.html' }), false)
    assert.equal(isAttachablePage({ url: 'chrome://extensions' }), false)
    assert.equal(isAttachablePage({ url: 'https://example.com' }), true)
    const text = composeSendText('hello', { url: 'chrome-extension://abc/x', title: 'VAV' })
    assert.equal(text, 'hello')
    assert.equal(text.includes('[Current page]'), false)
  })

  it('sends page-only context when the composer is empty', () => {
    const text = composeSendText('  ', { url: 'https://example.com', title: 'Example' })
    assert.equal(text.includes('summarize'), false)
    assert.match(text, /\[Current page\]/)
  })
})
