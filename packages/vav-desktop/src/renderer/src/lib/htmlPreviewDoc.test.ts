import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import { localFilePageUrl } from '@shared/localFileUrl.ts'
import {
  absolutizeProtocolRelativeUrl,
  canRewriteToVavLocal,
  isAbsoluteOrSpecialUrl,
  prepareHtmlSrcDoc,
  resolvePreviewAssetUrl,
  rewriteCssPreviewUrls
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

  it('turns protocol-relative CDNs into https so <base vav-local> cannot swallow them', () => {
    assert.equal(absolutizeProtocolRelativeUrl('//cdn.tailwindcss.com'), 'https://cdn.tailwindcss.com')
    assert.equal(
      resolvePreviewAssetUrl('/proj/index.html', '//unpkg.com/lucide@latest'),
      'https://unpkg.com/lucide@latest'
    )
    const out = prepareHtmlSrcDoc(
      '<!doctype html><html><head><script src="//cdn.tailwindcss.com"></script></head><body></body></html>',
      '/proj/index.html',
      parse
    )
    assert.match(out, /src="https:\/\/cdn\.tailwindcss\.com"/)
    assert.equal(
      rewriteCssPreviewUrls('body{background:url(//fonts.gstatic.com/s.woff2)}', '/proj/index.html'),
      'body{background:url("https://fonts.gstatic.com/s.woff2")}'
    )
  })

  it('rewrites local assets in Electron and leaves them relative in the web shell', () => {
    assert.equal(canRewriteToVavLocal(), true)
    const prev = globalThis.document
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { dataset: { phone: 'web' } } }
    })
    try {
      assert.equal(canRewriteToVavLocal(), false)
      assert.equal(resolvePreviewAssetUrl('/proj/index.html', './app.js'), './app.js')
      const out = prepareHtmlSrcDoc(
        '<!doctype html><html><head><script src="./app.js"></script></head><body></body></html>',
        '/proj/index.html',
        parse
      )
      assert.match(out, /src="\.\/app\.js"/)
      assert.doesNotMatch(out, /vav-local:\/\/local\/proj\/index\.html/)
    } finally {
      if (prev === undefined) delete (globalThis as { document?: unknown }).document
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: prev })
    }
  })
})
