import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyFileDraftContent,
  blockToRef,
  collectBlocks,
  countNewlinesLocal,
  formatCommentCardLabel,
  isSilentPreviewWindowWarning,
  pathsEqual,
  provisionalInspect
} from './fileViewerHelpers.ts'
import type { PreviewBlock } from './previewBlocks.ts'

describe('pathsEqual', () => {
  it('treats trailing slashes and ASCII case as the same path', () => {
    assert.equal(pathsEqual('/Tmp/A', '/tmp/a/'), true)
    assert.equal(pathsEqual('/tmp/a', '/tmp/b'), false)
  })
})

describe('applyFileDraftContent', () => {
  it('replaces, appends when baseLen matches, and ignores a stale append', () => {
    assert.equal(applyFileDraftContent('old', { content: 'next' }), 'next')
    assert.equal(applyFileDraftContent('ab', { append: 'c', baseLen: 2 }), 'abc')
    assert.equal(applyFileDraftContent('ab', { append: 'c', baseLen: 1 }), 'ab')
  })
})

describe('formatCommentCardLabel / collectBlocks / newlines', () => {
  it('labels line picks and flattens nested blocks', () => {
    const child: PreviewBlock = {
      id: 'c',
      kind: 'paragraph',
      text: 'x',
      startLine: 2,
      endLine: 4
    }
    const parent: PreviewBlock = {
      id: 'line-L10',
      kind: 'line',
      text: 'y',
      startLine: 10,
      endLine: 10,
      children: [child]
    }
    assert.equal(formatCommentCardLabel(parent), 'line 10')
    assert.equal(formatCommentCardLabel(child), 'paragraph · lines 2–4')
    assert.deepEqual(
      collectBlocks([parent]).map((b) => b.id),
      ['line-L10', 'c']
    )
    assert.equal(countNewlinesLocal('a\nb\n'), 2)
    assert.equal(blockToRef('/a.ts', 'ts', child).label, 'paragraph · lines 2–4')
    assert.equal(blockToRef('/a.ts', 'ts', child).id, '/a.ts::c')
  })
})

describe('isSilentPreviewWindowWarning / provisionalInspect', () => {
  it('hides windowing notices and guesses office kinds from the path', () => {
    assert.equal(isSilentPreviewWindowWarning('truncated to 48 x 120'), true)
    assert.equal(isSilentPreviewWindowWarning('Sheet Sheet1 truncated'), true)
    assert.equal(isSilentPreviewWindowWarning('password protected'), false)
    assert.equal(provisionalInspect('/docs/a.pdf')?.kind, 'pdf')
    assert.equal(provisionalInspect('/docs/a.ts'), null)
  })
})
