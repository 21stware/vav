import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { paintDockBadge } from './dockBadgePaint.ts'

function tile(size: number, opaque = true): { buf: Buffer; width: number; height: number } {
  const buf = Buffer.alloc(size * size * 4, 0)
  if (opaque) {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 40
      buf[i + 1] = 40
      buf[i + 2] = 40
      buf[i + 3] = 255
    }
  }
  return { buf, width: size, height: size }
}

function sample(buf: Buffer, width: number, x: number, y: number): { b: number; g: number; r: number; a: number } {
  const i = (y * width + x) * 4
  return { b: buf[i] ?? 0, g: buf[i + 1] ?? 0, r: buf[i + 2] ?? 0, a: buf[i + 3] ?? 0 }
}

describe('paintDockBadge', () => {
  it('paints a red mark in the top-right for a count', () => {
    const { buf, width, height } = tile(64)
    paintDockBadge(buf, width, height, '1')
    let found = false
    for (let y = 0; y < 20 && !found; y++) {
      for (let x = 44; x < 64; x++) {
        const pixel = sample(buf, width, x, y)
        if (pixel.r > 180 && pixel.r > pixel.g && pixel.r > pixel.b && pixel.a === 255) {
          found = true
          break
        }
      }
    }
    assert.equal(found, true)
  })

  it('is a no-op for an empty label', () => {
    const { buf, width, height } = tile(32)
    const before = Buffer.from(buf)
    paintDockBadge(buf, width, height, '')
    assert.deepEqual(buf, before)
  })
})
