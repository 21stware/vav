import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const dir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(dir, 'previews')

const light = {
  bgWindow: '#ececee',
  bgContent: '#fcfcfc',
  text: '#141416',
  textR: 0.078,
  textG: 0.078,
  textB: 0.086,
  veil: 'rgba(20,20,28,0.045)',
  selected: '#e2e2e6'
}

const dark = {
  bgWindow: '#121213',
  bgContent: '#1b1b1d',
  text: '#efeff1',
  textR: 0.937,
  textG: 0.937,
  textB: 0.945,
  veil: 'rgba(255,255,255,0.055)',
  selected: '#2f2f33'
}

const patterns = [
  { id: 'grain', name: 'Grain', w: 256, h: 256, size: 180, mode: 'image', opacity: 0.16, sheet: 0.28 },
  { id: 'dots', name: 'Dots', w: 16, h: 16, size: 16, mode: 'mask', opacity: 0.09, sheet: 0.16 },
  { id: 'graph', name: 'Graph', w: 32, h: 32, size: 32, mode: 'mask', opacity: 0.08, sheet: 0.14 },
  { id: 'plus', name: 'Plus', w: 24, h: 24, size: 24, mode: 'mask', opacity: 0.09, sheet: 0.16 },
  { id: 'hatch', name: 'Hatch', w: 10, h: 10, size: 10, mode: 'mask', opacity: 0.07, sheet: 0.13 },
  { id: 'scan', name: 'Scan', w: 8, h: 8, size: 8, mode: 'mask', opacity: 0.065, sheet: 0.12 },
  { id: 'fiber', name: 'Fiber', w: 96, h: 96, size: 96, mode: 'mask', opacity: 0.1, sheet: 0.18 },
  { id: 'speckle', name: 'Speckle', w: 64, h: 64, size: 64, mode: 'mask', opacity: 0.12, sheet: 0.2 },
  { id: 'ripple', name: 'Ripple', w: 48, h: 24, sizeW: 48, sizeH: 24, mode: 'mask', opacity: 0.08, sheet: 0.14 }
]

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function innerSvg(source) {
  return source
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()
}

function cardSvg(p, theme, source, width, height, opacity = p.opacity) {
  const tileW = p.sizeW ?? p.size
  const tileH = p.sizeH ?? p.size
  const inner = innerSvg(source)
  const ink = `0 0 0 0 ${theme.textR} 0 0 0 0 ${theme.textG} 0 0 0 0 ${theme.textB} 0 0 0 1 0`

  if (p.mode === 'image') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="p" patternUnits="userSpaceOnUse" width="${tileW}" height="${tileH}">
      <svg width="${tileW}" height="${tileH}" viewBox="0 0 ${p.w} ${p.h}">${inner}</svg>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${theme.bgWindow}"/>
  <rect width="100%" height="100%" fill="url(#p)" opacity="${opacity}"/>
</svg>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="p" patternUnits="userSpaceOnUse" width="${tileW}" height="${tileH}">
      <svg width="${tileW}" height="${tileH}" viewBox="0 0 ${p.w} ${p.h}">${inner}</svg>
    </pattern>
    <filter id="ink" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="${ink}"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="${theme.bgWindow}"/>
  <rect width="100%" height="100%" fill="url(#p)" filter="url(#ink)" opacity="${opacity}"/>
</svg>`
}

function labeledCard(p, theme, source, width, height) {
  const field = cardSvg(p, theme, source, width, height - 44, p.sheet).replace(
    '<?xml version="1.0" encoding="UTF-8"?>',
    ''
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${theme.bgWindow}"/>
  <svg y="0" width="${width}" height="${height - 44}">${innerSvg(field)}</svg>
  <rect x="16" y="${height - 36}" width="${width - 32}" height="22" rx="6" fill="${theme.bgContent}"/>
  <text x="28" y="${height - 21}" fill="${theme.text}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui" font-size="12" font-weight="600">${escapeXml(p.name)}</text>
</svg>`
}

function stageSvg(p, theme, source, width, height) {
  const field = cardSvg(p, theme, source, width, height)
  const inner = innerSvg(field)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${inner}
  <rect x="12" y="12" width="168" height="${height - 24}" rx="12" fill="${theme.bgWindow}" fill-opacity="0.35"/>
  <rect x="24" y="28" width="18" height="18" rx="5" fill="${theme.text}" fill-opacity="0.78"/>
  <rect x="24" y="58" width="144" height="28" rx="7" fill="${theme.selected}"/>
  <rect x="24" y="94" width="144" height="28" rx="7" fill="${theme.text}" fill-opacity="0.06"/>
  <rect x="24" y="130" width="144" height="28" rx="7" fill="${theme.text}" fill-opacity="0.06"/>
  <rect x="188" y="12" width="${width - 200}" height="${height - 24}" rx="14" fill="${theme.bgContent}"/>
  <text x="216" y="56" fill="${theme.text}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui" font-size="18" font-weight="600">${escapeXml(p.name)}</text>
  <text x="216" y="84" fill="${theme.text}" fill-opacity="0.55" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui" font-size="13">app-shell wash · --bg-window + pattern</text>
</svg>`
}

async function raster(svg, dest, width) {
  await sharp(Buffer.from(svg), { density: 192 })
    .resize({ width, withoutEnlargement: false })
    .png()
    .toFile(dest)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const sources = Object.fromEntries(
    await Promise.all(
      patterns.map(async (p) => [p.id, await readFile(path.join(dir, `${p.id}.svg`), 'utf8')])
    )
  )

  const cardW = 480
  const cardH = 300
  for (const themeName of ['light', 'dark']) {
    const theme = themeName === 'light' ? light : dark
    for (const p of patterns) {
      const svg = cardSvg(p, theme, sources[p.id], cardW, cardH)
      await raster(svg, path.join(outDir, `${p.id}-${themeName}.png`), cardW)
    }
    const stage = stageSvg(patterns[0], theme, sources.grain, 960, 420)
    await raster(stage, path.join(outDir, `stage-grain-${themeName}.png`), 960)
  }

  // Contact sheets: 3×3
  const cellW = 360
  const cellH = 240
  const cols = 3
  const rows = 3
  const gap = 16
  const pad = 28
  const sheetW = pad * 2 + cols * cellW + (cols - 1) * gap
  const sheetH = pad * 2 + 36 + rows * cellH + (rows - 1) * gap

  for (const themeName of ['light', 'dark']) {
    const theme = themeName === 'light' ? light : dark
    const tiles = []
    for (const [i, p] of patterns.entries()) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = pad + col * (cellW + gap)
      const y = pad + 36 + row * (cellH + gap)
      const labeled = labeledCard(p, theme, sources[p.id], cellW, cellH)
      tiles.push(
        `<svg x="${x}" y="${y}" width="${cellW}" height="${cellH}">${innerSvg(labeled)}</svg>`
      )
    }
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
  <rect width="100%" height="100%" fill="${theme.bgWindow}"/>
  <text x="${pad}" y="${pad + 18}" fill="${theme.text}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui" font-size="18" font-weight="600">VAV patterns · ${themeName}</text>
  ${tiles.join('\n')}
</svg>`
    await raster(sheet, path.join(outDir, `sheet-${themeName}.png`), sheetW)
  }

  console.log(`wrote ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
