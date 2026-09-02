import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inodeLabel, ownerLabel, statTimeMs, assembleBinaryMeta, tryBinaryMeta } from './fileBinaryMeta.ts'

describe('statTimeMs', () => {
  it('prefers a finite millisecond field, then Date', () => {
    assert.equal(statTimeMs(12.5), 12.5)
    assert.equal(statTimeMs(Number.NaN, new Date(1000)), 1000)
    assert.equal(statTimeMs(undefined, undefined), null)
  })
})

describe('inodeLabel / ownerLabel', () => {
  it('dashes missing inode and unknown uid', () => {
    assert.equal(inodeLabel(undefined), '—')
    assert.equal(inodeLabel(null), '—')
    assert.equal(inodeLabel(42n), '42')
    assert.equal(ownerLabel(-1), '—')
    assert.equal(ownerLabel(501), '501')
    assert.equal(ownerLabel(501, { uid: 501, username: 'ada' }), 'ada')
    assert.equal(ownerLabel(502, { uid: 501, username: 'ada' }), '502')
  })
})

describe('assembleBinaryMeta', () => {
  it('dashes missing mode and stamps owner, times, and inode', () => {
    const meta = assembleBinaryMeta(
      {
        uid: 501,
        ino: 9,
        birthtimeMs: 10,
        mtimeMs: 20
      },
      { self: { uid: 501, username: 'ada' }, uti: 'public.data', defaultApp: 'TextEdit' }
    )
    assert.equal(meta.permissions, '—')
    assert.equal(meta.owner, 'ada')
    assert.equal(meta.createdAt, 10)
    assert.equal(meta.modifiedAt, 20)
    assert.equal(meta.inode, '9')
    assert.equal(meta.uti, 'public.data')
    assert.equal(meta.defaultApp, 'TextEdit')
  })

  it('formats POSIX mode bits when present', () => {
    const meta = assembleBinaryMeta(
      { mode: 0o644, uid: -1 },
      { self: null, uti: 'public.data', defaultApp: null }
    )
    assert.equal(meta.permissions, '-rw-r--r-- (644)')
    assert.equal(meta.owner, '—')
  })
})

describe('tryBinaryMeta', () => {
  it('returns the assembled meta or the error message', async () => {
    const ok = await tryBinaryMeta(async () =>
      assembleBinaryMeta({}, { self: null, uti: 'public.data', defaultApp: null })
    )
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.binaryMeta.uti, 'public.data')
    const fail = await tryBinaryMeta(async () => {
      throw new Error('stat failed')
    })
    assert.equal(fail.ok, false)
    if (!fail.ok) assert.equal(fail.error, 'stat failed')
  })
})
