import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isFullHtmlDocument,
  isHtmlClipLang,
  prepareHtmlClipSrcDoc,
  resolveClipTheme,
  stripExternalClipLoaders
} from './htmlClip.ts'

describe('html-clip', () => {
  it('recognizes fence tags', () => {
    assert.equal(isHtmlClipLang('app'), true)
    assert.equal(isHtmlClipLang('html-clip'), true)
    assert.equal(isHtmlClipLang('HTML-CLIP'), true)
    assert.equal(isHtmlClipLang('html'), false)
  })

  it('wraps a fragment and injects chrome + CSP', () => {
    const doc = prepareHtmlClipSrcDoc('<button>Go</button>')
    assert.match(doc, /<!DOCTYPE html>/i)
    assert.match(doc, /Content-Security-Policy/)
    assert.match(doc, /data-vav-clip-chrome/)
    assert.match(doc, /<button>Go<\/button>/)
    assert.match(doc, /vav-html-clip/)
    assert.match(doc, /body \{ padding: 0; \}/)
    assert.match(doc, /animation: none/)
    assert.match(doc, /data-vav-clip-fit/)
    assert.match(doc, /data-theme="light"/)
    assert.match(doc, /vav-clip-theme/)
    assert.match(doc, /--vav-scheme/)
  })

  it('stamps dark scheme onto the html element', () => {
    const doc = prepareHtmlClipSrcDoc('<p>Hi</p>', { '--vav-scheme': 'dark' })
    assert.match(doc, /data-theme="dark"/)
    assert.match(doc, /color-scheme: dark/)
    assert.match(doc, /--text: #efeff1/)
  })

  it('does not mix light ink onto a dark plate', () => {
    const theme = resolveClipTheme({
      '--vav-scheme': 'dark',
      '--bg-content': '#1b1b1d',
      '--text': '#141416'
    })
    assert.equal(theme['--text'], '#efeff1')
    assert.equal(theme['--vav-scheme'], 'dark')
  })

  it('strips untrusted remotes, keeps inline and esm.sh', () => {
    const raw =
      '<script src="https://evil.example/x.js"></script>' +
      '<script src="https://esm.sh/xstate@5"></script>' +
      '<script>window.ready = true</script>' +
      '<iframe src="https://evil.example"></iframe>'
    const cleaned = stripExternalClipLoaders(raw)
    assert.doesNotMatch(cleaned, /evil\.example/)
    assert.match(cleaned, /esm\.sh\/xstate/)
    assert.match(cleaned, /window\.ready/)
  })

  it('keeps empty and official inspector iframes, drops srcdoc', () => {
    const raw =
      '<iframe id="inspector" title="Stately Inspector"></iframe>' +
      '<iframe src="https://stately.ai/inspect"></iframe>' +
      '<iframe src="about:blank"></iframe>' +
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>'
    const cleaned = stripExternalClipLoaders(raw)
    assert.match(cleaned, /id="inspector"/)
    assert.match(cleaned, /stately\.ai\/inspect/)
    assert.match(cleaned, /about:blank/)
    assert.doesNotMatch(cleaned, /srcdoc/)
  })

  it('prepared app keeps the inspector mount and import map', () => {
    const doc = prepareHtmlClipSrcDoc(
      '<iframe id="inspector"></iframe><script type="module">import { createBrowserInspector } from "@statelyai/inspect"</script>'
    )
    assert.match(doc, /id="inspector"/)
    assert.match(doc, /@statelyai\/inspect/)
    assert.match(doc, /frame-src https:\/\/stately\.ai/)
  })

  it('allows trusted CDN hosts in the prepared document CSP', () => {
    const doc = prepareHtmlClipSrcDoc('<script type="module">import "xstate"</script>')
    assert.match(doc, /esm\.sh/)
    assert.match(doc, /importmap/)
    assert.match(doc, /cdn\.tldraw\.com/)
    assert.match(doc, /stately\.ai/)
  })

  it('fits official full documents instead of 100vh centering', () => {
    const doc = prepareHtmlClipSrcDoc(
      '<!DOCTYPE html><html><body style="min-height:100vh"><svg viewBox="0 0 1000 400" style="min-width:900px"></svg></body></html>'
    )
    assert.match(doc, /data-vav-clip-fit/)
    assert.match(doc, /max-width: 100%/)
    assert.doesNotMatch(doc, /data-vav-clip-chrome/)
  })

  it('detects a full document', () => {
    assert.equal(isFullHtmlDocument('<!doctype html><html><body>x</body></html>'), true)
    assert.equal(isFullHtmlDocument('<div>x</div>'), false)
  })
})
