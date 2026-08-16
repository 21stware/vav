import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { cssTileSize, isCssTileSize, SURFACE_PATTERN_MAX_EDGE } from '../shared/surfacePattern.ts'
import { importSurfacePattern, writeSurfacePatternPng } from './importSurfacePattern.ts'

describe('cssTileSize', () => {
  it('writes both axes so CSS cannot square-stretch', () => {
    assert.equal(cssTileSize(160, 80), '160px 80px')
    assert.equal(isCssTileSize('160px 80px'), true)
    assert.equal(isCssTileSize('88px'), false)
    assert.equal(isCssTileSize(''), false)
  })
})

async function writeRgbaPng(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number]
): Promise<void> {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path)
}

describe('importSurfacePattern', () => {
  it('keeps only the alpha channel and the source aspect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    const src = join(dir, 'wide.png')
    const dest = join(dir, 'surface-pattern.png')
    await writeRgbaPng(src, 160, 80, (x) => [220, 40, 80, x < 80 ? 255 : 0])

    const result = await importSurfacePattern(src, dest)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.width / result.height, 2)
    assert.ok(result.width <= SURFACE_PATTERN_MAX_EDGE)
    assert.ok(result.height <= SURFACE_PATTERN_MAX_EDGE)
    assert.equal(result.size, cssTileSize(result.width, result.height))

    const out = await sharp(dest).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(out.info.width / out.info.height, 2)
    let sawInk = false
    let sawClear = false
    for (let i = 0; i < out.data.length; i += 4) {
      assert.equal(out.data[i], 0)
      assert.equal(out.data[i + 1], 0)
      assert.equal(out.data[i + 2], 0)
      const a = out.data[i + 3]!
      if (a > 200) sawInk = true
      if (a < 20) sawClear = true
    }
    assert.equal(sawInk, true)
    assert.equal(sawClear, true)
  })

  it('rejects an opaque JPEG — no alpha to use', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    const src = join(dir, 'tall.jpg')
    await sharp({
      create: { width: 60, height: 180, channels: 3, background: { r: 10, g: 10, b: 10 } }
    })
      .jpeg()
      .toFile(src)
    const result = await importSurfacePattern(src, join(dir, 'surface-pattern.png'))
    assert.deepEqual(result, { ok: false, reason: 'no-alpha' })
  })

  it('rejects an opaque PNG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    const src = join(dir, 'solid.png')
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 20, b: 20 } }
    })
      .png()
      .toFile(src)
    const result = await importSurfacePattern(src, join(dir, 'out.png'))
    assert.deepEqual(result, { ok: false, reason: 'no-alpha' })
  })

  it('rejects non-images', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    const src = join(dir, 'notes.txt')
    writeFileSync(src, 'hello')
    assert.deepEqual(await importSurfacePattern(src, join(dir, 'out.png')), {
      ok: false,
      reason: 'invalid'
    })
  })
})

describe('writeSurfacePatternPng', () => {
  it('accepts a valid PNG and reports its intrinsic size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    const dest = join(dir, 'surface-pattern.png')
    const png = await sharp({
      create: { width: 4, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
    })
      .png()
      .toBuffer()
    const result = writeSurfacePatternPng(png, dest)
    assert.ok(result)
    assert.equal(result.ok, true)
    assert.equal(result.width, 4)
    assert.equal(result.height, 2)
    assert.equal(result.size, '4px 2px')
  })

  it('rejects garbage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pattern-'))
    assert.equal(writeSurfacePatternPng(Buffer.from('not a png'), join(dir, 'x.png')), null)
  })
})
