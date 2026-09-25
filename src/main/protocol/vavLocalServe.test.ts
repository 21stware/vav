import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  clearVavLocalFileCache,
  parseByteRange,
  serveVavLocalRequest
} from './vavLocalServe.ts'

describe('parseByteRange', () => {
  it('parses closed, open-end, and suffix ranges', () => {
    assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 })
    assert.deepEqual(parseByteRange('bytes=100-', 1000), { start: 100, end: 999 })
    assert.deepEqual(parseByteRange('bytes=-50', 1000), { start: 950, end: 999 })
  })

  it('rejects empty or inverted ranges', () => {
    assert.equal(parseByteRange(null, 100), null)
    assert.equal(parseByteRange('bytes=80-20', 100), null)
    assert.equal(parseByteRange('bytes=100-120', 100), null)
    assert.equal(parseByteRange('bytes=', 100), null)
  })
})

describe('serveVavLocalRequest', () => {
  const dirs: string[] = []

  afterEach(() => {
    clearVavLocalFileCache()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function seed(name: string, contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'vav-local-'))
    dirs.push(dir)
    const path = join(dir, name)
    writeFileSync(path, contents)
    return path
  }

  it('answers OPTIONS without touching the disk', async () => {
    const result = await serveVavLocalRequest(
      { url: 'vav-local://preview/?path=%2Ftmp%2Fx.pdf', method: 'OPTIONS', range: null },
      { ioPath: (p) => p, isAllowed: () => false }
    )
    assert.equal(result.kind, 'options')
  })

  it('serves a range from the cached whole file on the second request', async () => {
    const path = seed('brief.pdf', 'ABCDEFGHIJ')
    const url = `vav-local://preview/?path=${encodeURIComponent(path)}`
    const deps = { ioPath: (p: string) => p, isAllowed: () => true }

    const first = await serveVavLocalRequest({ url, method: 'GET', range: 'bytes=0-3' }, deps)
    assert.equal(first.kind, 'file')
    if (first.kind !== 'file') return
    assert.equal(first.status, 206)
    assert.equal(Buffer.from(first.body as Uint8Array).toString(), 'ABCD')
    assert.equal(first.headers['Content-Range'], 'bytes 0-3/10')

    const second = await serveVavLocalRequest({ url, method: 'GET', range: 'bytes=6-9' }, deps)
    assert.equal(second.kind, 'file')
    if (second.kind !== 'file') return
    assert.equal(Buffer.from(second.body as Uint8Array).toString(), 'GHIJ')
  })

  it('forbids a path that is not granted', async () => {
    const path = seed('secret.pdf', '%PDF')
    const result = await serveVavLocalRequest(
      {
        url: `vav-local://preview/?path=${encodeURIComponent(path)}`,
        method: 'GET',
        range: null
      },
      { ioPath: (p) => p, isAllowed: () => false }
    )
    assert.deepEqual(result, { kind: 'error', status: 403 })
  })

  it('returns 404 for a missing file', async () => {
    const result = await serveVavLocalRequest(
      {
        url: 'vav-local://preview/?path=%2Ftmp%2Fvav-missing-preview.pdf',
        method: 'GET',
        range: null
      },
      { ioPath: (p) => p, isAllowed: () => true }
    )
    assert.deepEqual(result, { kind: 'error', status: 404 })
  })
})
