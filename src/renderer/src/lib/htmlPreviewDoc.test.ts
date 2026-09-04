import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import { localFilePageUrl } from '../../../shared/localFileUrl.ts'
import {
  isAbsoluteOrSpecialUrl,
  prepareHtmlSrcDoc,
  resolvePreviewAssetUrl
} from './htmlPreviewDoc.ts'

function parse(html: string): Document {
  return parseHTML(html).document as unknown as Document
}

describe('htmlPreviewDoc', () => {
  it('keeps author scripts so the page can paint', () => {
    const out = prepareHtmlSrcDoc(
      '<!doctype html><html><body><h1>Hi</h1><script>window.__vav = 1</script></body></html>',
      '/proj/index.html',
      parse
    )
    assert.match(out, /<script>window\.__vav = 1<\/script>/)
    assert.match(out, /data-vav-html-pick/)
  })

  it('rewrites relative scripts to the path-form local URL', () => {
    const out = prepareHtmlSrcDoc(
      '<!doctype html><html><head><script type="module" src="./app.js"></script></head><body></body></html>',
      '/proj/index.html',
      parse
    )
    assert.match(out, /src="vav-local:\/\/local\/proj\/app\.js"/)
    assert.match(out, new RegExp(`href="${localFilePageUrl('/proj/index.html').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  })

  it('leaves remote scripts and in-page anchors alone', () => {
    const out = prepareHtmlSrcDoc(
      '<!doctype html><html><body><script src="https://unpkg.com/react"></script><a href="#main">skip</a></body></html>',
      '/proj/index.html',
      parse
    )
    assert.match(out, /src="https:\/\/unpkg.com\/react"/)
    assert.match(out, /href="#main"/)
  })

  it('resolves sibling assets and ignores special URLs', () => {
    assert.equal(isAbsoluteOrSpecialUrl('https://a.test/x'), true)
    assert.equal(isAbsoluteOrSpecialUrl('./x.css'), false)
    assert.equal(resolvePreviewAssetUrl('/proj/index.html', './x.css'), 'vav-local://local/proj/x.css')
  })
})
