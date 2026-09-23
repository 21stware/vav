import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  blockToPreviewRef,
  composeContextUserText,
  formatBlockPickLabel,
  formatPreviewContext,
  formatPreviewLineRange,
  hasKnownLineRange,
  parsePreviewRefs
} from './previewContext.ts'
import type { PreviewRef } from './types.ts'

describe('parsePreviewRefs', () => {
  it('keeps valid refs and skips broken ones', () => {
    const refs = parsePreviewRefs([
      {
        id: '/tmp/a.md::p1',
        filePath: '/tmp/a.md',
        label: 'paragraph',
        startLine: 1,
        endLine: 2,
        text: 'hello',
        badge: 'MD'
      },
      { id: 'bad' }
    ])
    assert.equal(refs?.length, 1)
    assert.equal(refs?.[0]?.badge, 'MD')
    assert.equal(parsePreviewRefs([]), undefined)
  })
})

describe('preview line range', () => {
  it('treats 0 as unknown so office/media picks do not invent line 1', () => {
    assert.equal(hasKnownLineRange(0, 0), false)
    assert.equal(formatPreviewLineRange(0, 0), '')
    assert.equal(formatPreviewLineRange(1, 1), 'line 1')
    assert.equal(formatPreviewLineRange(3, 8), 'lines 3–8')
  })

  it('labels DOM / media picks from the block label, not line 0', () => {
    assert.equal(
      formatBlockPickLabel({
        kind: 'paragraph',
        label: 'Slide 2 · title',
        startLine: 0,
        endLine: 0
      }),
      'Slide 2 · title'
    )
    assert.equal(
      formatBlockPickLabel({
        kind: 'line',
        id: 'line-L12',
        startLine: 12,
        endLine: 12
      }),
      'line 12'
    )
    assert.equal(
      formatBlockPickLabel({
        kind: 'heading',
        label: 'H1 Install',
        startLine: 4,
        endLine: 4
      }),
      'H1 Install · line 4'
    )
  })
})

describe('formatPreviewContext', () => {
  const mdRef: PreviewRef = {
    id: '/tmp/a.md::h1-L1-hello',
    filePath: '/tmp/a.md',
    label: 'H1 hello',
    startLine: 1,
    endLine: 3,
    text: '# hello\n\nbody',
    badge: 'Markdown'
  }

  it('emits a real line range for text/code picks', () => {
    const out = formatPreviewContext([mdRef])
    assert.match(out, /## Selected context/)
    assert.match(out, /\/tmp\/a\.md Markdown · H1 hello · lines 1–3/)
    assert.match(out, /# hello/)
  })

  it('omits a dummy line range for office DOM / media picks', () => {
    const office: PreviewRef = {
      id: '/tmp/deck.pptx::dom-0',
      filePath: '/tmp/deck.pptx',
      label: 'Slide 1 · title',
      startLine: 0,
      endLine: 0,
      text: 'Q3 Review',
      badge: 'PPTX'
    }
    const out = formatPreviewContext([office])
    assert.match(out, /Slide 1 · title/)
    assert.doesNotMatch(out, /lines 1–1/)
    assert.doesNotMatch(out, /line 0/)
  })

  it('includes the user note when the comment card is filled', () => {
    const out = formatPreviewContext([{ ...mdRef, comment: 'tighten this intro' }])
    assert.match(out, /User note: tighten this intro/)
  })
})

describe('blockToPreviewRef', () => {
  it('scopes the id by path and keeps unknown line ranges at 0', () => {
    const known = blockToPreviewRef('/tmp/a.md', 'Markdown', {
      id: 'h1-L1-hello',
      kind: 'heading',
      text: '# hello',
      label: 'H1 hello',
      startLine: 1,
      endLine: 1
    })
    assert.equal(known.id, '/tmp/a.md::h1-L1-hello')
    assert.equal(known.startLine, 1)
    const office = blockToPreviewRef('/tmp/deck.pptx', 'PPTX', {
      id: 'dom-0',
      kind: 'heading',
      text: 'Q3 Review',
      label: 'Slide 1 · title',
      startLine: 0,
      endLine: 0
    })
    assert.equal(office.startLine, 0)
    assert.equal(office.label, 'Slide 1 · title')
  })
})

describe('composeContextUserText', () => {
  it('does not duplicate a range already baked into the chip label', () => {
    const ref = blockToPreviewRef('/tmp/a.md', 'Markdown', {
      id: 'h1-L4',
      kind: 'heading',
      text: '# Install',
      label: 'H1 Install',
      startLine: 4,
      endLine: 4
    })
    const out = formatPreviewContext([ref])
    assert.equal((out.match(/line 4/g) ?? []).length, 1)
  })

  it('orders selection → attachments → user text', () => {
    const out = composeContextUserText(
      'rewrite this',
      [
        {
          id: '/tmp/a.ts::line-L2',
          filePath: '/tmp/a.ts',
          label: 'line 2',
          startLine: 2,
          endLine: 2,
          text: 'return a + b',
          badge: 'TS'
        }
      ],
      ['/tmp/shot.png']
    )
    assert.match(out, /Selected context[\s\S]*Attachments:[\s\S]*rewrite this/)
    assert.match(out, /line 2/)
  })

  it('prefixes the selected VAV note before the user text', () => {
    const out = composeContextUserText('调研金价，写到 Note 里', null, null, {
      kind: 'knowledge',
      level: 'item',
      title: 'Meeting notes',
      path: '/tmp/notes/kh1.md',
      objectId: 'n1',
      url: 'vav://app/knowledge?id=kh1'
    })
    assert.match(out, /## VAV app context/)
    assert.match(out, /Meeting notes/)
    assert.match(out, /MacVise/)
    assert.match(out, /调研金价/)
  })
})
