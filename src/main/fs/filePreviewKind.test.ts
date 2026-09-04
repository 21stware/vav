import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countNewlines, mimeFor, previewKind } from './filePreviewKind.ts'
import { modeToPermissions } from './fileMode.ts'
import { sortEntries } from './fileEntrySort.ts'
import type { FileEntry } from '../../shared/types.ts'

function entry(name: string, isDirectory = false, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    path: `/repo/${name}`,
    name,
    isDirectory,
    size: extra.size ?? 0,
    modifiedAt: extra.modifiedAt ?? 0,
    createdAt: extra.createdAt ?? 0
  }
}

describe('previewKind / mimeFor / countNewlines', () => {
  it('classifies source, office, media, and clip names', () => {
    assert.equal(previewKind('a.ts'), 'text')
    assert.equal(previewKind('Makefile'), 'text')
    assert.equal(previewKind('.env.local'), 'text')
    assert.equal(previewKind('notes.csv'), 'csv')
    assert.equal(previewKind('pic.png'), 'image')
    assert.equal(previewKind('deck.pptx'), 'pptx')
    assert.equal(previewKind('app.html'), 'html-clip')
    assert.equal(previewKind('index.html'), 'html')
    assert.equal(previewKind('data.sqlite'), 'sqlite')
    assert.equal(previewKind('song.mp3'), 'audio')
    assert.equal(previewKind('clip.mp4'), 'video')
    assert.equal(previewKind('blob.bin'), 'binary')
  })

  it('maps kinds to mime types and counts display lines', () => {
    assert.equal(mimeFor('a.png', 'image'), 'image/png')
    assert.equal(mimeFor('a.heic', 'image'), 'image/heic')
    assert.equal(mimeFor('a.xhtml', 'html'), 'application/xhtml+xml')
    assert.equal(mimeFor('a.ts', 'text'), 'text/plain')
    assert.equal(countNewlines('a\nb\n'), 2)
    assert.equal(countNewlines(''), 0)
  })
})

describe('modeToPermissions / sortEntries', () => {
  it('renders POSIX bits and keeps folders ahead of files', () => {
    assert.equal(modeToPermissions(0o755), '-rwxr-xr-x (755)')
    assert.equal(modeToPermissions(0o644), '-rw-r--r-- (644)')
    const rows = sortEntries(
      [entry('b.ts'), entry('a', true), entry('c.ts')],
      'name',
      true
    )
    assert.deepEqual(
      rows.map((r) => r.name),
      ['a', 'b.ts', 'c.ts']
    )
    const bySize = sortEntries(
      [entry('big.ts', false, { size: 9 }), entry('small.ts', false, { size: 1 })],
      'size',
      true
    )
    assert.deepEqual(
      bySize.map((r) => r.name),
      ['small.ts', 'big.ts']
    )
  })
})
