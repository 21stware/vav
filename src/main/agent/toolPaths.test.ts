import assert from 'node:assert/strict'
import { resolve as resolvePath, sep } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildSelectionAnchor,
  fsReadErrorHint,
  resolveDocPath,
  resolveInWorkdir,
  textWindowPrefix
} from './toolPaths.ts'

describe('resolveInWorkdir / resolveDocPath', () => {
  it('keeps absolute paths and joins relatives', () => {
    assert.equal(resolveInWorkdir('/w', '/abs'), '/abs')
    assert.equal(resolveInWorkdir('/w', 'src/a.ts'), resolvePath('/w', 'src/a.ts'))
    assert.equal(resolveInWorkdir('/w', 'src/a.ts').endsWith(`src${sep}a.ts`), true)
  })

  it('prefers explicit path, then default, then selection', () => {
    const host = {
      workdir: '/w',
      defaultDocPath: () => '/w/default.md',
      selectionAnchor: () => [{ id: 'x', filePath: '/w/sel.md', text: 'hi' }]
    }
    assert.equal(resolveDocPath(host, '/explicit.md'), '/explicit.md')
    assert.equal(resolveDocPath(host, '  '), '/w/default.md')
    assert.equal(resolveDocPath({ workdir: '/w', selectionAnchor: host.selectionAnchor }, ''), '/w/sel.md')
    assert.equal(resolveDocPath({ workdir: '/w' }, ''), null)
  })
})

describe('buildSelectionAnchor / fsReadErrorHint / textWindowPrefix', () => {
  it('joins selected text and block ids', () => {
    const anchor = buildSelectionAnchor({
      selectionAnchor: () => [
        { id: '/a.ts::b1', filePath: '/a.ts', text: ' one ' },
        { id: 'b2', filePath: '/a.ts', text: 'two' }
      ]
    })
    assert.equal(anchor?.text, 'one\n\ntwo')
    assert.deepEqual(anchor?.blockIds, ['b1', 'b2'])
  })

  it('hints office, csv, and binary reads', () => {
    assert.match(fsReadErrorHint('/a.pdf', 'nope'), /doc_search/)
    assert.match(fsReadErrorHint('/a.csv', 'nope'), /sql_query/)
    assert.match(fsReadErrorHint('/a.png', 'binary'), /cannot be read as UTF-8/)
    assert.equal(fsReadErrorHint('/a.ts', 'missing'), '')
  })

  it('prefixes truncated and mid-file windows', () => {
    assert.match(
      textWindowPrefix({ truncated: true, startByte: 0, endByte: 10, totalBytes: 20 }),
      /start_byte=10/
    )
    assert.equal(
      textWindowPrefix({ truncated: false, startByte: 5, endByte: 10, totalBytes: 20 }),
      '[bytes 5–10 of 20]\n\n'
    )
    assert.equal(
      textWindowPrefix({ truncated: false, startByte: 0, endByte: 10, totalBytes: 10 }),
      ''
    )
  })
})
