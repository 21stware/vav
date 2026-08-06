#!/usr/bin/env node
// Derives AVIF/WebP variants for the marketing site from the captured PNGs.
//
//   node scripts/optimize-site-images.mjs [--force]
//
// Run after scripts/capture-marketing-screenshot.mjs. The PNGs stay in the repo
// as the <img> fallback; browsers pick a derivative from <picture>.

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, 'site/assets')
const force = process.argv.includes('--force')

// Screenshots are captured at 2x. Each also gets a half-width variant so 1x
// displays don't download twice the pixels they can show.
const RETINA_SOURCES = /^screenshot.*\.png$/

const WEBP = { quality: 78, effort: 6, smartSubsample: true }
const AVIF = { quality: 60, effort: 6, chromaSubsampling: '4:4:4' }

// Social card: cover-cropped from the hero shot, kept small enough that
// crawlers fetch it quickly.
const OG_CARD = { source: 'screenshot.png', out: 'og.png', width: 1200, height: 630 }

function isStale(source, out) {
  if (force || !existsSync(out)) return true
  return statSync(source).mtimeMs > statSync(out).mtimeMs
}

function kb(path) {
  return `${Math.round(statSync(path).size / 1024)}KB`
}

async function deriveVariants(name) {
  const source = join(assets, name)
  const stem = basename(name, '.png')
  const { width } = await sharp(source).metadata()
  if (!width) throw new Error(`${name}: no width in metadata`)

  const widths = width >= 900 ? [Math.round(width / 2), width] : [width]
  const written = []

  for (const target of widths) {
    const suffix = target === width ? '' : `-${target}w`
    for (const [ext, options] of [
      ['webp', WEBP],
      ['avif', AVIF]
    ]) {
      const out = join(assets, `${stem}${suffix}.${ext}`)
      if (!isStale(source, out)) continue
      await sharp(source)
        .resize({ width: target, withoutEnlargement: true })
        [ext](options)
        .toFile(out)
      written.push(`${basename(out)} ${kb(out)}`)
    }
  }

  return { stem, sourceSize: statSync(source).size, written }
}

async function deriveOgCard() {
  const source = join(assets, OG_CARD.source)
  if (!existsSync(source)) return null
  const out = join(assets, OG_CARD.out)
  if (!isStale(source, out)) return null
  await sharp(source)
    .resize({ width: OG_CARD.width, height: OG_CARD.height, fit: 'cover', position: 'top' })
    .png({ compressionLevel: 9, palette: true })
    .toFile(out)
  return `${OG_CARD.out} ${kb(out)}`
}

async function main() {
  if (!existsSync(assets)) throw new Error(`missing ${assets}`)
  mkdirSync(assets, { recursive: true })

  const sources = readdirSync(assets)
    .filter((name) => RETINA_SOURCES.test(name))
    .sort()

  let png = 0
  let derived = 0
  for (const name of sources) {
    const { stem, sourceSize, written } = await deriveVariants(name)
    png += sourceSize
    for (const line of written) console.log(`  ${line}`)
    if (!written.length) console.log(`  ${stem}: up to date`)
  }

  const og = await deriveOgCard()
  if (og) console.log(`  ${og}`)

  for (const name of readdirSync(assets)) {
    if (/\.(avif|webp)$/.test(name)) derived += statSync(join(assets, name)).size
  }

  console.log(
    `\n${sources.length} screenshots · PNG ${Math.round(png / 1024)}KB → derivatives ${Math.round(derived / 1024)}KB`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
