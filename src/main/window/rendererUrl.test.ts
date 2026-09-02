import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRendererUrl } from './rendererUrl.ts'

describe('isRendererUrl', () => {
  it('accepts the Vite dev server and packaged file URLs', () => {
    const dev = 'http://localhost:5173'
    assert.equal(isRendererUrl(dev, dev), true)
    assert.equal(isRendererUrl(`${dev}/#/settings`, dev), true)
    assert.equal(isRendererUrl(`${dev}?window=preview`, dev), true)
    assert.equal(isRendererUrl('file:///app/index.html', dev), true)
    assert.equal(isRendererUrl('https://example.com', dev), false)
    assert.equal(isRendererUrl('about:blank', undefined), false)
  })
})
