import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeSendText, formatPageContext } from './chromePageContext.ts'

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

  it('sends page-only context when the composer is empty', () => {
    const text = composeSendText('  ', { url: 'https://example.com', title: 'Example' })
    assert.equal(text.includes('summarize'), false)
    assert.match(text, /\[Current page\]/)
  })
})
