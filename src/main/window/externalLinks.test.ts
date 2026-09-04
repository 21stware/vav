import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isHttpUrl, wireExternalLinks } from './externalLinks.ts'

describe('isHttpUrl', () => {
  it('accepts http(s) and rejects app / about URLs', () => {
    assert.equal(isHttpUrl('https://example.com/a'), true)
    assert.equal(isHttpUrl('http://localhost:1'), true)
    assert.equal(isHttpUrl('file:///app/index.html'), false)
    assert.equal(isHttpUrl('about:blank'), false)
  })
})

describe('wireExternalLinks', () => {
  it('denies window.open and opens http outside; keeps renderer URLs in-window', () => {
    const opened: string[] = []
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined
    let navHandler: ((event: { preventDefault: () => void }, url: string) => void) | undefined
    wireExternalLinks(
      {
        setWindowOpenHandler: (handler) => {
          openHandler = handler
        },
        on: (_event, listener) => {
          navHandler = listener
        }
      },
      (url) => opened.push(url),
      (url) => url.startsWith('file:')
    )
    assert.equal(openHandler?.({ url: 'https://ex.test' }).action, 'deny')
    assert.deepEqual(opened, ['https://ex.test'])
    let prevented = false
    navHandler?.({ preventDefault: () => { prevented = true } }, 'https://ex.test/docs')
    assert.equal(prevented, true)
    prevented = false
    navHandler?.({ preventDefault: () => { prevented = true } }, 'file:///app/index.html')
    assert.equal(prevented, false)
  })
})
