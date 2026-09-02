import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { zipLocalHeadersEncrypted } from './fileZip.ts'

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

describe('zipLocalHeadersEncrypted', () => {
  it('detects the encryption flag on a local-file header', () => {
    assert.equal(zipLocalHeadersEncrypted(localHeader({})), false)
    assert.equal(zipLocalHeadersEncrypted(localHeader({ encrypted: true })), true)
  })

  it('skips a clear first entry and still sees a later encrypted one', () => {
    const first = localHeader({ nameLen: 3, extraLen: 0, compSize: 0 })
    first.write('src', 30, 3, 'utf8')
    const second = localHeader({ encrypted: true })
    assert.equal(zipLocalHeadersEncrypted(Buffer.concat([first, second])), true)
  })
})
