import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import type { HostFs } from '../host/HostFs.ts'
import { zipLocalHeadersEncrypted } from './fileZip.ts'
import {
  inspectZipArchive,
  probeZipEncrypted,
  summarizeZipArchive,
  ZIP_FULL_LOAD_MAX,
  zipInspectWarnings,
  zipTreeText
} from './fileZipArchive.ts'

function localHeader(opts: { encrypted?: boolean; nameLen?: number; extraLen?: number; compSize?: number }): Buffer {
  const nameLen = opts.nameLen ?? 0
  const extraLen = opts.extraLen ?? 0
  const compSize = opts.compSize ?? 0
  const buf = Buffer.alloc(30 + nameLen + extraLen + compSize)
  buf.writeUInt32LE(0x04034b50, 0)
  buf.writeUInt16LE(opts.encrypted ? 1 : 0, 6)
  buf.writeUInt32LE(compSize, 18)
  buf.writeUInt16LE(nameLen, 26)
  buf.writeUInt16LE(extraLen, 28)
  return buf
}

function memoryFs(buffer: Buffer): HostFs {
  return {
    async open() {
      return {
        async read(dest, offset, length, position) {
          const slice = buffer.subarray(position, position + length)
          slice.copy(dest, offset)
          return { bytesRead: slice.length }
        },
        async close() {}
      }
    },
    async readFile() {
      return buffer
    },
    async readdir() {
      return []
    },
    async stat() {
      throw new Error('unused')
    },
    async writeFile() {},
    async mkdir() {},
    async rename() {},
    watch() {
      return { on() {}, close() {} }
    },
    async exists() {
      return true
    },
    async unlink() {}
  } as HostFs
}

describe('summarizeZipArchive', () => {
  it('sorts paths, counts files, and computes a clamped ratio', () => {
    const info = summarizeZipArchive(
      [
        { path: 'b.txt', name: 'b.txt', isDirectory: false, compressedSize: 40, uncompressedSize: 100 },
        { path: 'a/', name: 'a/', isDirectory: true, compressedSize: 0, uncompressedSize: 0 },
        { path: 'a/z.txt', name: 'z.txt', isDirectory: false, compressedSize: 10, uncompressedSize: 100 }
      ],
      999,
      false,
      false
    )
    assert.deepEqual(
      info.entries.map((e) => e.path),
      ['a/', 'a/z.txt', 'b.txt']
    )
    assert.equal(info.entryCount, 2)
    assert.equal(info.compressedSize, 50)
    assert.equal(info.uncompressedSize, 200)
    assert.equal(info.ratio, 75)
    assert.equal(info.encrypted, false)
    assert.equal(info.truncated, false)
  })

  it('falls back to archive file size when compressed totals are empty', () => {
    const info = summarizeZipArchive([], 4096, true, true)
    assert.equal(info.entryCount, 0)
    assert.equal(info.compressedSize, 4096)
    assert.equal(info.uncompressedSize, 0)
    assert.equal(info.ratio, 0)
    assert.equal(info.encrypted, true)
    assert.equal(info.truncated, true)
  })

  it('counts directory-only archives by entry length', () => {
    const info = summarizeZipArchive(
      [{ path: 'empty/', name: 'empty/', isDirectory: true, compressedSize: 0, uncompressedSize: 0 }],
      100,
      false,
      false
    )
    assert.equal(info.entryCount, 1)
    assert.equal(info.compressedSize, 100)
  })
})

describe('zipTreeText / zipInspectWarnings', () => {
  it('formats a D/F tree', () => {
    assert.equal(
      zipTreeText([
        { isDirectory: true, path: 'src/' },
        { isDirectory: false, path: 'src/a.ts' }
      ]),
      'D src/\nF src/a.ts'
    )
  })

  it('warns for encryption and a truncated large archive', () => {
    assert.deepEqual(zipInspectWarnings({ encrypted: false, truncated: false, fileSize: 10 }), [])
    const warnings = zipInspectWarnings({
      encrypted: true,
      truncated: true,
      fileSize: 80 * 1024 * 1024
    })
    assert.equal(warnings.length, 2)
    assert.match(warnings[0]!, /password-protected/)
    assert.match(warnings[1]!, /80 MB/)
  })
})

describe('probeZipEncrypted', () => {
  it('reads a prefix and reuses the local-header scan', async () => {
    const clear = localHeader({})
    const secret = localHeader({ encrypted: true })
    assert.equal(await probeZipEncrypted(memoryFs(clear), '/a.zip', clear.length), false)
    assert.equal(await probeZipEncrypted(memoryFs(secret), '/a.zip', secret.length), true)
    assert.equal(await probeZipEncrypted(memoryFs(Buffer.alloc(8)), '/a.zip', 8), false)
    assert.equal(zipLocalHeadersEncrypted(secret), true)
  })
})

describe('inspectZipArchive', () => {
  it('lists a small in-memory zip without truncation', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'hello')
    zip.folder('dir')
    const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
    const info = await inspectZipArchive(memoryFs(buffer), '/a.zip', buffer.length)
    assert.equal(info.truncated, false)
    assert.equal(info.encrypted, false)
    assert.ok(info.entries.some((e) => e.path === 'hello.txt' && !e.isDirectory))
    assert.ok(info.entryCount >= 1)
  })

  it('skips JSZip load when the declared size is over the budget', async () => {
    const header = localHeader({ encrypted: true })
    const info = await inspectZipArchive(memoryFs(header), '/big.zip', ZIP_FULL_LOAD_MAX + 1)
    assert.equal(info.truncated, true)
    assert.equal(info.encrypted, true)
    assert.deepEqual(info.entries, [])
    assert.equal(info.compressedSize, ZIP_FULL_LOAD_MAX + 1)
  })
})
