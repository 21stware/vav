#!/usr/bin/env node
/**
 * Document icons for every format VAV can claim as a default opener.
 *
 * Finder / Explorer fall back to the app tile when a document type has no
 * CFBundleTypeIconFile / ProgId icon. This paints each format (plus the
 * generic catch-all) from the same SVG the renderer inlines, then keeps the
 * packaging config in step with the catalog.
 *
 *     npm run brand:file-icons
 *
 * Writes:
 *
 *     build/file-icons/{id}.png     1024 master
 *     build/file-icons/{id}.icns    macOS (via iconutil)
 *     build/file-icons/{id}.ico     Windows (PNG frames)
 *     build/file-icons/preview.png  contact sheet (not shipped)
 *     build/file-icons/manifest.json
 *     packages/vav-desktop/electron-builder.json  association blocks
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  FILE_ASSOCIATION_CATEGORIES,
  FILE_ASSOCIATION_FORMATS,
  GENERIC_FILE_ICON,
  formatUtis
} from '../src/shared/fileAssociationFormats.ts'
import { fileTypeIconSvg } from '../src/shared/fileTypeIconSvg.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'build', 'file-icons')
const BUILDER = join(root, 'packages', 'vav-desktop', 'electron-builder.json')

const MASTER = 1024
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_SIZES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

const cache = new Map()
/** Each pixel size is drawn from its own layout, never downscaled from the master. */
async function render(spec, size) {
  const key = `${spec.id}@${size}`
  if (!cache.has(key)) {
    const svg = fileTypeIconSvg(spec, size, { standalone: true })
    const png = sharp(Buffer.from(svg), { density: 72 })
      .resize(size, size)
      .png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 })
    cache.set(key, await png.toBuffer())
  }
  return cache.get(key)
}

/** ICO with PNG-compressed frames (Vista+). */
function encodeIco(frames) {
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach(({ size, png }, i) => {
    const at = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...frames.map((frame) => frame.png)])
}

/** Pixel size of each PNG-bearing icns chunk. */
const ICNS_PNG_CHUNKS = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }

/**
 * iconutil owns the container (and the packed ARGB 16/32 frames), but it
 * re-encodes PNGs at ~3× the size a palette PNG needs for flat artwork, and
 * 56 of these ship in the bundle. Swap the PNG chunks for compact ones.
 */
async function compactIcns(file) {
  const src = readFileSync(file)
  const chunks = []
  for (let o = 8; o < src.length; ) {
    const type = src.toString('latin1', o, o + 4)
    const length = src.readUInt32BE(o + 4)
    let data = src.subarray(o + 8, o + length)
    const px = ICNS_PNG_CHUNKS[type]
    if (px) {
      const smaller = await sharp(data).png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 }).toBuffer()
      if (smaller.length < data.length) data = smaller
    }
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(data.length + 8, 4)
    chunks.push(head, data)
    o += length
  }
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  writeFileSync(file, Buffer.concat([head, body]))
}

async function writeIcns(spec, dest) {
  const scratch = mkdtempSync(join(tmpdir(), `vav-${spec.id}-`))
  const iconset = join(scratch, `${spec.id}.iconset`)
  mkdirSync(iconset)
  try {
    for (const [size, name] of ICNS_SIZES) writeFileSync(join(iconset, name), await render(spec, size))
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', dest], { stdio: 'pipe' })
    await compactIcns(dest)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Every format at 96 / 32 / 16 px, grouped by category, on light and dark halves. */
async function writePreview(dest) {
  const cols = 10
  const cellW = 132
  const cellH = 168
  const pad = 28
  const headH = 34
  const groups = [
    ...FILE_ASSOCIATION_CATEGORIES.map((category) => ({
      title: category,
      items: FILE_ASSOCIATION_FORMATS.filter((f) => f.category === category)
    })),
    { title: 'fallback', items: [GENERIC_FILE_ICON] }
  ]
  const tiles = []
  const labels = []
  let y = pad
  for (const group of groups) {
    labels.push(
      `<text x="${pad}" y="${y + 20}" font-family="Helvetica Neue" font-size="15" font-weight="700" fill="#6B6A66" letter-spacing="1.5">${group.title.toUpperCase()}</text>`
    )
    y += headH
    for (const [i, spec] of group.items.entries()) {
      const x = pad + (i % cols) * cellW
      const top = y + Math.floor(i / cols) * cellH
      tiles.push({ input: await render(spec, 96), left: x + (cellW - 96) / 2, top })
      tiles.push({ input: await render(spec, 32), left: x + cellW / 2 - 34, top: top + 102 })
      tiles.push({ input: await render(spec, 16), left: x + cellW / 2 + 14, top: top + 110 })
      labels.push(
        `<text x="${x + cellW / 2}" y="${top + 152}" text-anchor="middle" font-family="Helvetica Neue" font-size="12" fill="#3A3935">${escapeXml(spec.label)}</text>`
      )
    }
    y += Math.ceil(group.items.length / cols) * cellH + 12
  }
  const width = pad * 2 + cols * cellW
  const height = y + pad
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join('')}</svg>`
  await sharp({ create: { width, height, channels: 4, background: '#F4F3EF' } })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }, ...tiles])
    .png()
    .toFile(dest)
}

function docType(format) {
  return {
    CFBundleTypeName: format.label,
    CFBundleTypeRole: 'Viewer',
    LSHandlerRank: 'Alternate',
    CFBundleTypeIconFile: `${format.id}.icns`,
    CFBundleTypeExtensions: format.extensions.map((ext) => ext.slice(1)),
    LSItemContentTypes: formatUtis(format)
  }
}

/** Rewrite the association blocks from the catalog; everything else is left alone. */
function syncBuilderConfig() {
  const config = JSON.parse(readFileSync(BUILDER, 'utf8'))
  const icons = [...FILE_ASSOCIATION_FORMATS, GENERIC_FILE_ICON].map((spec) => ({
    from: `build/file-icons/${spec.id}.icns`,
    to: `${spec.id}.icns`
  }))
  const firstIcon = config.extraResources.findIndex((entry) => String(entry.from).startsWith('build/file-icons/'))
  const kept = config.extraResources.filter((entry) => !String(entry.from).startsWith('build/file-icons/'))
  const at = firstIcon >= 0 ? firstIcon : kept.length
  config.extraResources = [...kept.slice(0, at), ...icons, ...kept.slice(at)]

  const info = config.mac.extendInfo
  const managed = new Set(['Folders', 'Files', ...FILE_ASSOCIATION_FORMATS.map((f) => f.label)])
  const previous = info.CFBundleDocumentTypes ?? []
  const folders = previous.find((entry) => entry.CFBundleTypeName === 'Folders')
  const files = previous.find((entry) => entry.CFBundleTypeName === 'Files')
  info.CFBundleDocumentTypes = [
    ...(folders ? [folders] : []),
    ...FILE_ASSOCIATION_FORMATS.map(docType),
    // Legacy rows from an older catalog would otherwise linger forever.
    ...previous.filter((entry) => !managed.has(entry.CFBundleTypeName) && entry.CFBundleTypeIconFile == null),
    {
      ...(files ?? {
        CFBundleTypeName: 'Files',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: ['public.data', 'public.item', 'public.content']
      }),
      CFBundleTypeIconFile: `${GENERIC_FILE_ICON.id}.icns`
    }
  ]
  info.UTImportedTypeDeclarations = FILE_ASSOCIATION_FORMATS.filter((f) => f.importConformsTo).map((format) => ({
    UTTypeIdentifier: format.uti,
    UTTypeDescription: format.label,
    UTTypeConformsTo: format.importConformsTo,
    UTTypeIconFile: `${format.id}.icns`,
    UTTypeTagSpecification: {
      'public.filename-extension': format.extensions.map((ext) => ext.slice(1))
    }
  }))

  config.fileAssociations = FILE_ASSOCIATION_FORMATS.map((format) => {
    const ext = format.extensions.map((e) => e.slice(1))
    return {
      ext: ext.length === 1 ? ext[0] : ext,
      name: format.label,
      description: format.label,
      role: 'Viewer',
      rank: 'Alternate',
      icon: `file-icons/${format.id}`
    }
  })
  writeFileSync(BUILDER, `${JSON.stringify(config, null, 2)}\n`)
}

async function main() {
  if (process.platform === 'darwin' && !existsSync('/usr/bin/iconutil')) {
    throw new Error('iconutil missing — install Xcode command line tools')
  }
  mkdirSync(OUT, { recursive: true })
  const specs = [...FILE_ASSOCIATION_FORMATS, GENERIC_FILE_ICON]
  const ids = new Set(specs.map((spec) => spec.id))
  for (const name of readdirSync(OUT)) {
    const id = name.replace(/\.(png|icns|ico)$/, '')
    if (id !== name && id !== 'preview' && !ids.has(id)) rmSync(join(OUT, name))
  }

  for (const spec of specs) {
    writeFileSync(join(OUT, `${spec.id}.png`), await render(spec, MASTER))
    const frames = []
    for (const size of WIN_SIZES) frames.push({ size, png: await render(spec, size) })
    writeFileSync(join(OUT, `${spec.id}.ico`), encodeIco(frames))
    if (process.platform === 'darwin') await writeIcns(spec, join(OUT, `${spec.id}.icns`))
    else console.warn(`warn: not on macOS — kept existing ${spec.id}.icns`)
    console.log(`${spec.id.padEnd(12)} ${(spec.badge ?? '—').padEnd(6)} ${spec.color}`)
  }

  await writePreview(join(OUT, 'preview.png'))
  const manifest = FILE_ASSOCIATION_FORMATS.map((format) => ({
    id: format.id,
    label: format.label,
    extensions: format.extensions.map((ext) => ext.slice(1)),
    uti: format.uti,
    utis: formatUtis(format),
    ...(format.importConformsTo ? { importConformsTo: format.importConformsTo } : {}),
    tier: format.tier,
    category: format.category,
    badge: format.badge,
    color: format.color,
    icon: format.id
  }))
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  syncBuilderConfig()
  console.log(`done. ${specs.length} icons → ${OUT}`)
}

await main()
