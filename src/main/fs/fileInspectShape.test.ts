import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  binaryInspectFallback,
  deniedInspectResult,
  directoryInspectResult,
  heicInspectResult,
  inspectCaughtError,
  inspectErrorOnBase,
  inspectFileBase,
  inspectWithBinaryMeta,
  inspectWithError,
  LEGACY_PPT_WARNING,
  legacyBinaryInspect,
  legacyDocInspect,
  legacyPptInspect,
  officeFirstPaintInspect,
  remappedConvertedInspect,
  sqliteInspectResult,
  sqliteQueryFailure,
  structuredInspectIsPartial,
  structuredInspectReject,
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

  it('stamps a stream URL on the inspect base and overlays catch errors', () => {
    const base = inspectFileBase({
      path: '/notes.md',
      name: 'notes.md',
      size: 12,
      mtimeMs: 9,
      kind: 'text',
      mime: 'text/plain'
    })
    assert.equal(base.streamUrl, 'vav-local://preview/?path=%2Fnotes.md')
    assert.equal(base.kind, 'text')
    assert.equal(inspectErrorOnBase(base, new Error('disk'), 'fallback').error, 'disk')
    assert.equal(inspectErrorOnBase(base, new Error(''), 'fallback').error, 'fallback')
    assert.equal(inspectErrorOnBase(base, {}).error, 'error')
    assert.equal(inspectWithError(base, 'denied').error, 'denied')
    assert.equal(
      inspectWithBinaryMeta(base, {
        uti: 'public.data',
        permissions: 'rw',
        owner: 'me',
        createdAt: null,
        modifiedAt: 9,
        inode: '1',
        defaultApp: null
      }).binaryMeta?.modifiedAt,
      9
    )
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

    const doc = legacyDocInspect({
      path: '/a.doc',
      name: 'a.doc',
      size: 8,
      mtimeMs: 3,
      warning: 'convert failed'
    })
    assert.equal(doc.mime, 'application/msword')
    assert.deepEqual(doc.warnings, ['convert failed'])

    const ppt = legacyPptInspect({ path: '/a.ppt', name: 'a.ppt', size: 4, mtimeMs: 3 })
    assert.equal(ppt.mime, 'application/vnd.ms-powerpoint')
    assert.deepEqual(ppt.warnings, [LEGACY_PPT_WARNING])
    assert.equal(
      legacyPptInspect({ path: '/a.ppt', name: 'a.ppt', size: 4, error: 'stat' }).error,
      'stat'
    )
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

  it('rejects structured inspect on lock/empty/large and flags partial warnings', () => {
    const lock = structuredInspectReject({
      isFile: true,
      locked: true,
      size: 10,
      parseSoft: 100,
      lockMessage: 'lock'
    })
    assert.equal(lock?.error, 'lock')
    assert.equal(
      structuredInspectReject({
        isFile: false,
        locked: false,
        size: 10,
        parseSoft: 100,
        lockMessage: 'lock'
      })?.error,
      'Not a file'
    )
    assert.equal(
      structuredInspectReject({
        isFile: true,
        locked: false,
        size: 0,
        parseSoft: 100,
        lockMessage: 'lock'
      })?.error,
      'File is empty.'
    )
    assert.match(
      structuredInspectReject({
        isFile: true,
        locked: false,
        size: 200,
        parseSoft: 100,
        lockMessage: 'lock'
      })?.error ?? '',
      /too large/
    )
    assert.equal(structuredInspectReject({
      isFile: true,
      locked: false,
      size: 10,
      parseSoft: 100,
      lockMessage: 'lock'
    }), null)
    assert.equal(structuredInspectIsPartial(true, []), true)
    assert.equal(structuredInspectIsPartial(false, ['first 48 blocks']), true)
    assert.equal(structuredInspectIsPartial(false, ['ok']), false)
    assert.equal(sqliteQueryFailure(2, 5, 'denied').error, 'denied')
    assert.equal(sqliteQueryFailure(undefined, undefined, 'x').limit, 100)
  })
})
