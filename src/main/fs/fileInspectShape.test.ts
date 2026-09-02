import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  binaryInspectFallback,
  deniedInspectResult,
  directoryInspectResult,
  heicInspectResult,
  inspectCaughtError,
  legacyBinaryInspect,
  officeFirstPaintInspect,
  remappedConvertedInspect,
  sqliteInspectResult,
  textWindowInspectResult
} from './fileInspectShape.ts'

describe('fileInspectShape', () => {
  it('returns a binary error stub for denied paths', () => {
    assert.deepEqual(deniedInspectResult('/secret', 'secret', 'not allowed'), {
      path: '/secret',
      name: 'secret',
      size: 0,
      kind: 'binary',
      mime: '',
      error: 'not allowed'
    })
  })

  it('never labels folders as binary', () => {
    assert.deepEqual(directoryInspectResult('/tmp/proj', 'proj', 9), {
      path: '/tmp/proj',
      name: 'proj',
      size: 0,
      mtimeMs: 9,
      kind: 'directory',
      mime: 'inode/directory'
    })
  })

  it('windows text, sqlite tables, HEIC sidecars, and binary fallbacks', () => {
    const base = {
      path: '/a',
      name: 'a',
      size: 12,
      kind: 'text' as const,
      mime: 'text/plain'
    }
    const text = textWindowInspectResult(base, {
      content: 'one\ntwo',
      truncated: true,
      startByte: 0,
      endByte: 7,
      totalBytes: 20
    })
    assert.equal(text.lineCount, 2)
    assert.equal(text.truncated, true)

    const sqlite = sqliteInspectResult(
      { ...base, kind: 'sqlite', mime: 'application/x-sqlite3' },
      { tables: [{ name: 't', columns: ['id'], rowCount: 3 }] }
    )
    assert.match(sqlite.text ?? '', /t \(3 rows/)
    assert.equal(sqlite.lineCount, 1)

    const heic = heicInspectResult(
      { ...base, kind: 'image', mime: 'image/heic' },
      { converted: true, previewPath: '/tmp/a.jpg', meta: [{ key: 'Make', value: 'Apple' }] }
    )
    assert.equal(heic.mime, 'image/jpeg')
    assert.equal(heic.contentPath, '/tmp/a.jpg')
    assert.match(heic.warnings?.[0] ?? '', /HEIC/)

    const fallback = binaryInspectFallback(base, 42)
    assert.equal(fallback.binaryMeta?.modifiedAt, 42)
    assert.equal(inspectCaughtError('/a', 'a', new Error('boom')).error, 'boom')
  })

  it('remaps converted sidecars and builds legacy binary inspects', () => {
    const inner = {
      path: '/tmp/converted.docx',
      name: 'converted.docx',
      size: 9,
      kind: 'docx' as const,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      warnings: ['inner']
    }
    const remapped = remappedConvertedInspect(
      inner,
      { path: '/a.doc', name: 'a.doc', size: 12, mtimeMs: 3 },
      '/tmp/converted.docx',
      'converted'
    )
    assert.equal(remapped.path, '/a.doc')
    assert.equal(remapped.contentPath, '/tmp/converted.docx')
    assert.deepEqual(remapped.warnings, ['inner', 'converted'])

    const legacy = legacyBinaryInspect({
      path: '/a.ppt',
      name: 'a.ppt',
      size: 4,
      mime: 'application/vnd.ms-powerpoint',
      warnings: ['export to pptx']
    })
    assert.equal(legacy.kind, 'binary')
    assert.equal(legacy.mime, 'application/vnd.ms-powerpoint')
  })

  it('streams Office first paint and skips index on lock/empty', () => {
    const base = {
      path: '/a.docx',
      name: 'a.docx',
      size: 4,
      kind: 'docx' as const,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    assert.equal(
      officeFirstPaintInspect(base, {
        locked: true,
        streamUrl: 'vav-local://a',
        lockMessage: 'lock'
      }).error,
      'lock'
    )
    assert.equal(
      officeFirstPaintInspect(base, {
        empty: true,
        streamUrl: 'vav-local://a',
        lockMessage: 'lock'
      }).error,
      'File is empty.'
    )
    const large = officeFirstPaintInspect(base, {
      streamUrl: 'vav-local://io',
      large: true,
      lockMessage: 'lock'
    })
    assert.equal(large.streamUrl, 'vav-local://io')
    assert.match(large.warnings?.[0] ?? '', /streaming/)
  })
})
