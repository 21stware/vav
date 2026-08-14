import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PreviewBlock } from '../../../shared/previewBlock.ts'
import { parsePythonIndentBlocks } from './previewPythonBlocks.ts'

function covers(block: PreviewBlock, line: number): boolean {
  return line >= block.startLine && line <= block.endLine
}

function atLine(roots: PreviewBlock[], line: number): PreviewBlock | null {
  for (const block of roots) {
    if (!covers(block, line)) continue
    let current = block
    while (current.children) {
      const child = current.children.find((c) => covers(c, line))
      if (!child) break
      current = child
    }
    return current
  }
  return null
}

function parentOf(roots: PreviewBlock[], id: string): PreviewBlock | null {
  let found: PreviewBlock | null = null
  const walk = (list: PreviewBlock[], parent: PreviewBlock | null): void => {
    for (const b of list) {
      if (b.id === id) {
        found = parent
        return
      }
      if (b.children) walk(b.children, b)
      if (found) return
    }
  }
  walk(roots, null)
  return found
}

describe('parsePythonIndentBlocks', () => {
  it('keeps a Black-style multiline def together with its suite', () => {
    const src = [
      'def foo(',
      '    a: int,',
      '    b: int,',
      ') -> int:',
      '    return a + b',
      ''
    ].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const fn = atLine(blocks, 1)
    assert.ok(fn)
    assert.equal(fn.startLine, 1)
    assert.equal(fn.endLine, 5)
    assert.equal(atLine(blocks, 5)?.id, atLine(blocks, 5)?.id)
    const body = atLine(blocks, 5)
    assert.ok(body)
    assert.match(body.text, /return a \+ b/)
    assert.equal(parentOf(blocks, body.id)?.startLine, 1)
  })

  it('does not treat ) as ending the suite so the body is selectable', () => {
    const src = ['def foo(', '    a,', '):', '    body()', 'next = 1', ''].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const body = atLine(blocks, 4)
    assert.ok(body, 'body() must belong to a block')
    assert.match(parentOf(blocks, body.id)?.text ?? '', /def foo/)
    const next = atLine(blocks, 5)
    assert.ok(next)
    assert.match(next.text, /next = 1/)
    assert.equal(parentOf(blocks, next.id), null)
  })

  it('groups if / elif / else and still lets each clause be picked', () => {
    const src = [
      'if a:',
      '    x()',
      'elif b:',
      '    y()',
      'else:',
      '    z()',
      ''
    ].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const chain = atLine(blocks, 1)
    assert.ok(chain)
    assert.equal(chain.startLine, 1)
    assert.equal(chain.endLine, 6)
    const elif = atLine(blocks, 3)
    assert.ok(elif)
    assert.match(elif.text, /^elif b:/)
    assert.equal(elif.endLine, 4)
    assert.equal(parentOf(blocks, elif.id)?.id, chain.id)
    const els = atLine(blocks, 5)
    assert.ok(els)
    assert.match(els.text, /^else:/)
    const x = atLine(blocks, 2)
    assert.ok(x)
    assert.match(x.text, /x\(\)/)
    assert.equal(parentOf(blocks, x.id)?.id, chain.id)
  })

  it('attaches except / else / finally to try', () => {
    const src = [
      'try:',
      '    a()',
      'except E:',
      '    b()',
      'else:',
      '    c()',
      'finally:',
      '    d()',
      ''
    ].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const tr = atLine(blocks, 1)
    assert.ok(tr)
    assert.equal(tr.startLine, 1)
    assert.equal(tr.endLine, 8)
    assert.equal(parentOf(blocks, atLine(blocks, 3)!.id)?.id, tr.id)
    assert.equal(parentOf(blocks, atLine(blocks, 5)!.id)?.id, tr.id)
    assert.equal(parentOf(blocks, atLine(blocks, 7)!.id)?.id, tr.id)
  })

  it('attaches for-else and folds decorators into def', () => {
    const src = [
      '@app.route(',
      '    "/x",',
      ')',
      'def foo():',
      '    for i in xs:',
      '        use(i)',
      '    else:',
      '        missing()',
      ''
    ].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const fn = atLine(blocks, 1)
    assert.ok(fn)
    assert.equal(fn.startLine, 1)
    assert.equal(fn.endLine, 8)
    assert.match(fn.text, /@app.route/)
    const loop = atLine(blocks, 5)
    assert.ok(loop)
    assert.match(loop.text, /for i in xs:/)
    assert.equal(loop.endLine, 8)
    const els = atLine(blocks, 7)
    assert.ok(els)
    assert.match(els.text, /else:/)
    assert.equal(parentOf(blocks, els.id)?.id, loop.id)
  })

  it('does not let a parenthesized call swallow the next statement', () => {
    const src = ['x = foo(', '    1,', ')', 'y = 2', ''].join('\n')
    const blocks = parsePythonIndentBlocks(src)
    const call = atLine(blocks, 1)
    assert.ok(call)
    assert.equal(call.endLine, 3)
    const y = atLine(blocks, 4)
    assert.ok(y)
    assert.match(y.text, /y = 2/)
    assert.notEqual(y.id, call.id)
  })
})
