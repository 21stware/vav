import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { localFilePageUrl, localFileStreamUrl, parseVavLocalFilePath } from './localFileUrl.ts'

describe('localFileUrl', () => {
  it('keeps the query form for streaming previews', () => {
    assert.equal(localFileStreamUrl('/notes.md'), 'vav-local://preview/?path=%2Fnotes.md')
  })

  it('encodes an absolute POSIX path so relative modules resolve as siblings', () => {
    const href = localFilePageUrl('/Users/ada/proj/index.html')
    assert.equal(href, 'vav-local://local/Users/ada/proj/index.html')
    const resolved = new URL('./app.js', href)
    assert.equal(resolved.href, 'vav-local://local/Users/ada/proj/app.js')
    assert.equal(parseVavLocalFilePath(resolved.href), '/Users/ada/proj/app.js')
  })

  it('round-trips Windows paths through the path form', () => {
    const href = localFilePageUrl('C:\\Users\\ada\\page.html')
    assert.equal(href, 'vav-local://local/C:/Users/ada/page.html')
    assert.equal(parseVavLocalFilePath(href), 'C:/Users/ada/page.html')
  })

  it('reads the legacy query form and ignores cache-busting params on the path form', () => {
    assert.equal(
      parseVavLocalFilePath('vav-local://preview/?path=%2Ftmp%2Fa.js'),
      '/tmp/a.js'
    )
    assert.equal(
      parseVavLocalFilePath('vav-local://local/tmp/a.js?rev=3'),
      '/tmp/a.js'
    )
    assert.equal(parseVavLocalFilePath('https://example.com/x'), null)
  })
})
