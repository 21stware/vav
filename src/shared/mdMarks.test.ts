import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import katex from 'katex'
import {
  extractCiteKeys,
  findMdMarks,
  looksLikeLatex,
  parseDocHits
} from './mdMarks.ts'

describe('katex', () => {
  it('renders the bracket formula agents emit', () => {
    const tex = '364 \\times (1.052)^{6} \\approx 492\\text{亿元}'
    const html = katex.renderToString(tex, {
      displayMode: true,
      throwOnError: true,
      output: 'html'
    })
    assert.match(html, /katex/)
    assert.match(html, /亿元/)
  })
})

describe('looksLikeLatex', () => {
  it('accepts the bracket formula agents actually emit', () => {
    assert.equal(
      looksLikeLatex(' 364 \\times (1.052)^{6} \\approx 492\\text{亿元} '),
      true
    )
  })

  it('rejects cites and ordinary brackets', () => {
    assert.equal(looksLikeLatex('web:1'), false)
    assert.equal(looksLikeLatex('doc:abc'), false)
    assert.equal(looksLikeLatex('hello world'), false)
    assert.equal(looksLikeLatex('x'), false)
  })
})

describe('findMdMarks', () => {
  it('treats [ latex ] as display math, not a cite', () => {
    const src = '[ 364 \\times (1.052)^{6} \\approx 492\\text{亿元} ]'
    const marks = findMdMarks(src)
    assert.equal(marks.length, 1)
    assert.equal(marks[0]!.kind, 'math')
    if (marks[0]!.kind !== 'math') return
    assert.equal(marks[0].display, true)
    assert.match(marks[0].tex, /\\times/)
    assert.match(marks[0].tex, /\\text\{亿元\}/)
  })

  it('parses $ $ / $$ $$ / \\( \\) / \\[ \\]', () => {
    const marks = findMdMarks('inline $x^2$ and $$E=mc^2$$ then \\(a+b\\) and \\[c\\]')
    const kinds = marks.map((m) =>
      m.kind === 'math' ? `${m.display ? 'd' : 'i'}:${m.tex}` : `${m.cite}:${m.id}`
    )
    assert.deepEqual(kinds, ['i:x^2', 'd:E=mc^2', 'i:a+b', 'd:c'])
  })

  it('does not treat $100 as math', () => {
    assert.deepEqual(findMdMarks('costs $100 and $200 more'), [])
  })

  it('parses [web:N] and [doc:id] cites', () => {
    const cites = findMdMarks(
      'see [web:1] and [doc:p3-c2] plus [doc:abc | file.pdf | Page 1]'
    )
      .filter((m) => m.kind === 'cite')
      .map((m) => (m.kind === 'cite' ? `${m.cite}:${m.id}` : ''))
    assert.deepEqual(cites, ['web:1', 'doc:p3-c2', 'doc:abc'])
  })

  it('does not steal a markdown link', () => {
    assert.equal(findMdMarks('[364 \\times 2](https://x.test)').length, 0)
  })

  it('leaves ordinary [note] text alone', () => {
    assert.deepEqual(findMdMarks('see [note] and [1]'), [])
  })
})

describe('extractCiteKeys', () => {
  it('dedupes keys from mixed prose', () => {
    assert.deepEqual(extractCiteKeys('[web:1] then [web:1] and [doc:a]'), [
      'web:1',
      'doc:a'
    ])
  })

  it('reads keys from tool-output lines', () => {
    assert.deepEqual(
      extractCiteKeys('1. [web:1] Title\n   url: https://x.test\n2. [web:2] Other'),
      ['web:1', 'web:2']
    )
    assert.deepEqual(
      extractCiteKeys('1. [doc:c1 | report.pdf | Page 2] score=0.8\n   snippet'),
      ['doc:c1']
    )
  })
})

describe('parseDocHits', () => {
  it('parses numbered doc_search rows', () => {
    const { header, hits } = parseDocHits(
      [
        'Found 2 chunk(s) in report.pdf · 12 indexed',
        '',
        '1. [doc:c1 | report.pdf | Page 2] score=0.8 (bm25)',
        '   first snippet',
        '',
        '2. [doc:c2 | report.pdf | Page 3] score=0.6 (embed)',
        '   second'
      ].join('\n')
    )
    assert.match(header, /Found 2/)
    assert.equal(hits.length, 2)
    assert.equal(hits[0]!.id, 'c1')
    assert.equal(hits[0]!.path, 'report.pdf')
    assert.equal(hits[0]!.loc, 'Page 2')
    assert.match(hits[0]!.body, /first snippet/)
    assert.equal(hits[1]!.id, 'c2')
  })

  it('parses bare doc_fetch blocks', () => {
    const { hits } = parseDocHits(
      ['Fetched 1 chunk(s) from report.pdf', '', '[doc:c1 | report.pdf | Page 2]', 'full text'].join(
        '\n'
      )
    )
    assert.equal(hits.length, 1)
    assert.equal(hits[0]!.id, 'c1')
    assert.equal(hits[0]!.body, 'full text')
  })
})
