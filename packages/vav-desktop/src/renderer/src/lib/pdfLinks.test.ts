import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPdfLinkAnnotation,
  pdfLinkRectCss,
  pdfLinkTarget,
  resolvePdfDestPage,
  safePdfExternalUrl
} from './pdfLinks.ts'

describe('pdf link annotation', () => {
  it('accepts Link subtype or annotationType 2', () => {
    assert.equal(isPdfLinkAnnotation({ subtype: 'Link' }), true)
    assert.equal(isPdfLinkAnnotation({ annotationType: 2 }), true)
    assert.equal(isPdfLinkAnnotation({ subtype: 'Text' }), false)
    assert.equal(isPdfLinkAnnotation(null), false)
  })

  it('only allows http(s) external URLs', () => {
    assert.equal(safePdfExternalUrl('https://example.com/a'), 'https://example.com/a')
    assert.equal(safePdfExternalUrl('http://example.com'), 'http://example.com/')
    assert.equal(safePdfExternalUrl('javascript:alert(1)'), null)
    assert.equal(safePdfExternalUrl('file:///tmp/a'), null)
    assert.equal(safePdfExternalUrl(''), null)
  })

  it('prefers a URI over an internal dest', () => {
    assert.deepEqual(
      pdfLinkTarget({
        subtype: 'Link',
        url: 'https://ex.test/x',
        dest: 'Section1'
      }),
      { kind: 'uri', url: 'https://ex.test/x' }
    )
    assert.deepEqual(pdfLinkTarget({ subtype: 'Link', dest: 'TOC' }), {
      kind: 'dest',
      dest: 'TOC'
    })
    assert.deepEqual(pdfLinkTarget({ subtype: 'Link', action: 'NextPage' }), {
      kind: 'named',
      action: 'NextPage'
    })
    assert.equal(pdfLinkTarget({ subtype: 'Highlight', dest: 'TOC' }), null)
  })

  it('normalizes a viewport rectangle', () => {
    const box = pdfLinkRectCss([10, 80, 40, 20], (r) => [r[0]!, r[3]!, r[2]!, r[1]!])
    assert.deepEqual(box, { left: 10, top: 20, width: 30, height: 60 })
    assert.equal(pdfLinkRectCss([0, 0, 0.5, 0.5], (r) => r), null)
  })

  it('converts via convertToViewportPoint when rectangle helper is gone', () => {
    const box = pdfLinkRectCss([10, 20, 40, 80], {
      convertToViewportPoint: (x, y) => [x, 100 - y]
    })
    assert.deepEqual(box, { left: 10, top: 20, width: 30, height: 60 })
  })
})

describe('resolvePdfDestPage', () => {
  it('resolves a named dest through getDestination + page ref', async () => {
    const page = await resolvePdfDestPage('Chap2', {
      getDestination: async (name) => {
        assert.equal(name, 'Chap2')
        return [{ num: 7, gen: 0 }, { name: 'XYZ' }, 0, 0, null]
      },
      getPageIndex: async (ref) => {
        assert.deepEqual(ref, { num: 7, gen: 0 })
        return 6
      }
    })
    assert.equal(page, 7)
  })

  it('treats a numeric dest page ref as 0-based', async () => {
    const page = await resolvePdfDestPage([3, { name: 'XYZ' }], {
      getDestination: async () => {
        throw new Error('not a name')
      },
      getPageIndex: async () => {
        throw new Error('should not call')
      }
    })
    assert.equal(page, 4)
  })

  it('returns null when the dest cannot be resolved', async () => {
    assert.equal(
      await resolvePdfDestPage('missing', {
        getDestination: async () => null,
        getPageIndex: async () => 0
      }),
      null
    )
  })
})
