#!/usr/bin/env node
/**
 * Office preview fidelity harness.
 *
 * Paints each document twice — once with LibreOffice (the reference: headless
 * convert to PDF, rasterised at 96 dpi) and once with the renderer the app
 * ships, inside the app's own stylesheet — then writes per-page side-by-side
 * and overlay images plus a similarity score.
 *
 * Usage:
 *   node scripts/office-fidelity/run.mjs <file.docx>... [--out dir] [--renderer vav|officecli]
 *
 * `--renderer officecli` scores the bundled officecli HTML view instead of
 * the app's renderer, for comparing engines. `--entry <file> --pages <css>`
 * swaps in any other browser entry that defines `window.paintDocx(url)`.
 *
 * Needs `soffice` (LibreOffice) and `pdftoppm` (poppler) on PATH.
 *
 * Output (default /tmp/vav-office-fidelity):
 *   ref/<name>-<n>.png    LibreOffice page
 *   cand/<name>-<n>.png   vav page
 *   cmp/<name>-<n>.png    reference | vav | overlay (red = reference only, blue = vav only)
 *   report.json           page counts and per-page scores
 */

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const STYLES = join(ROOT, 'packages/vav-desktop/src/renderer/src/styles')
const DPI = 96

function parseArgs(argv) {
  const files = []
  let out = '/tmp/vav-office-fidelity'
  let renderer = 'vav'
  let entry = join(HERE, 'entry.ts')
  let pages = 'section.docx-native'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]
    else if (argv[i] === '--renderer') renderer = argv[++i]
    else if (argv[i] === '--entry') entry = resolve(argv[++i])
    else if (argv[i] === '--pages') pages = argv[++i]
    else files.push(resolve(argv[i]))
  }
  return { files, out: resolve(out), renderer, entry, pages }
}

function stem(file) {
  return basename(file, extname(file)).replace(/[^\w.-]+/g, '_')
}

const SUBSTITUTIONS = JSON.parse(readFileSync(join(HERE, 'fontSubstitutions.json'), 'utf8'))

/**
 * A throwaway LibreOffice profile whose replacement table maps Windows-only
 * fonts (宋体, 仿宋, …) to the macOS faces vav falls back to. Without it a
 * headless LibreOffice draws no glyphs at all for a missing CJK face, and the
 * reference is a blank page.
 */
function loProfile(out) {
  const dir = join(out, '.lo-profile')
  const xcu = join(dir, 'user', 'registrymodifications.xcu')
  if (existsSync(xcu)) return dir
  mkdirSync(dirname(xcu), { recursive: true })
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const prop = (k, v) => `<prop oor:name="${k}" oor:op="fuse"><value>${esc(String(v))}</value></prop>`
  const pairs = Object.entries(SUBSTITUTIONS)
    .map(
      ([from, to], i) =>
        `<item oor:path="/org.openoffice.Office.Common/Font/Substitution/FontPairs"><node oor:name="_${i}" oor:op="replace">${prop('Always', true)}${prop('OnScreenOnly', false)}${prop('ReplaceFont', from)}${prop('SubstituteFont', to)}</node></item>`
    )
    .join('\n')
  writeFileSync(
    xcu,
    `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Font/Substitution">${prop('Replacement', true)}</item>
${pairs}
</oor:items>
`
  )
  return dir
}

function renderReference(file, refDir, profile) {
  const name = stem(file)
  const pdfDir = join(refDir, '.pdf')
  mkdirSync(pdfDir, { recursive: true })
  execFileSync('soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', pdfDir, file], {
    stdio: 'ignore',
    // Headless LibreOffice on macOS defaults to the svp backend, whose
    // fontconfig sees only LibreOffice's own fonts. The Quartz backend sees
    // the system's — the same faces Chromium (and so vav) lays out with.
    env: process.platform === 'darwin' ? { ...process.env, SAL_USE_VCLPLUGIN: 'osx' } : process.env
  })
  const pdf = join(pdfDir, `${basename(file, extname(file))}.pdf`)
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', pdf, join(refDir, name)])
  // pdftoppm pads page numbers to the page count's width; normalise to -<n>.
  const pages = readdirSync(refDir)
    .filter((f) => f.startsWith(`${name}-`) && f.endsWith('.png'))
    .map((f) => ({ f, n: Number(f.slice(name.length + 1, -4)) }))
    .sort((a, b) => a.n - b.n)
  return pages.map(({ f, n }) => {
    const to = join(refDir, `${name}-${n}.png`)
    if (f !== `${name}-${n}.png`) execFileSync('mv', [join(refDir, f), to])
    return to
  })
}

async function bundle(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: 'chrome120',
    loader: { '.css': 'text' },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : [],
    logLevel: 'warning'
  })
  return result.outputFiles[0].text
}

function serve(bundleJs, docs) {
  const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let body = null
    let type = 'application/octet-stream'
    if (url === '/' || url === '/index.html') {
      body = readFileSync(join(HERE, 'page.html'))
      type = types['.html']
    } else if (url === '/bundle.js') {
      body = bundleJs
      type = types['.js']
    } else if (url.startsWith('/styles/')) {
      const p = join(STYLES, url.slice('/styles/'.length))
      if (p.startsWith(STYLES) && existsSync(p)) {
        body = readFileSync(p)
        type = types[extname(p)] ?? type
      }
    } else if (url.startsWith('/doc/')) {
      const p = docs.get(url.slice('/doc/'.length))
      if (p) body = readFileSync(p)
    }
    if (body == null) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': type }).end(body)
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function renderCandidate(page, origin, file, candDir, pageSelector) {
  const name = stem(file)
  await page.goto(`${origin}/`)
  const count = await page.evaluate((u) => window.paintDocx(u), `/doc/${encodeURIComponent(name + extname(file))}`)
  const sections = await page.$$(pageSelector)
  const out = []
  for (let i = 0; i < sections.length; i++) {
    const to = join(candDir, `${name}-${i + 1}.png`)
    await sections[i].screenshot({ path: to })
    out.push(to)
  }
  if (out.length !== count) throw new Error(`captured ${out.length} of ${count} pages`)
  return out
}

const OFFICECLI = join(ROOT, 'resources/bin', process.platform === 'win32' ? 'officecli.exe' : 'officecli')

async function renderOfficecli(page, file, candDir) {
  const name = stem(file)
  const html = join(candDir, '.html', `${name}.html`)
  mkdirSync(dirname(html), { recursive: true })
  execFileSync(OFFICECLI, ['view', file, 'html', '-o', html], { stdio: 'ignore' })
  await page.goto(`file://${html}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  const pages = await page.$$('.page')
  const out = []
  for (let i = 0; i < pages.length; i++) {
    const to = join(candDir, `${name}-${i + 1}.png`)
    await pages[i].screenshot({ path: to })
    out.push(to)
  }
  return out
}

/** Grey, blurred, fixed-width rendition used for scoring and overlays. */
async function normalised(file, width, height) {
  return sharp(file)
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()
}

async function compare(refPng, candPng, cmpPng) {
  const refMeta = await sharp(refPng).metadata()
  const W = refMeta.width
  const H = refMeta.height
  const candMeta = candPng ? await sharp(candPng).metadata() : null

  // Score at a coarse scale with blur so one-pixel anti-aliasing noise does
  // not dominate: what is measured is "is the ink in the same place".
  const sw = 200
  const sh = Math.round((H / W) * sw)
  let score = null
  if (candPng) {
    const blur = async (f) =>
      sharp(await normalised(f, sw, sh), { raw: { width: sw, height: sh, channels: 1 } })
        .blur(1.5)
        .raw()
        .toBuffer()
    const a = await blur(refPng)
    const b = await blur(candPng)
    let inkA = 0
    let inkB = 0
    let both = 0
    let diff = 0
    for (let i = 0; i < a.length; i++) {
      const ia = a[i] < 235
      const ib = b[i] < 235
      if (ia) inkA++
      if (ib) inkB++
      if (ia && ib) both++
      diff += Math.abs(a[i] - b[i])
    }
    score = {
      inkIoU: inkA + inkB - both ? +(both / (inkA + inkB - both)).toFixed(3) : 1,
      meanDiff: +(diff / a.length).toFixed(2),
      size: candMeta ? `${candMeta.width}x${candMeta.height} vs ${W}x${H}` : null
    }
  }

  const ref = await normalised(refPng, W, H)
  const cand = candPng ? await normalised(candPng, W, H) : Buffer.alloc(W * H, 255)
  const overlay = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) {
    const r = ref[i] < 160
    const c = cand[i] < 160
    const o = i * 3
    if (r && c) overlay.set([40, 40, 40], o)
    else if (r) overlay.set([230, 40, 40], o)
    else if (c) overlay.set([40, 90, 230], o)
    else overlay.set([255, 255, 255], o)
  }
  const gap = 12
  const panel = async (buf, channels) =>
    sharp(buf, { raw: { width: W, height: H, channels } }).png().toBuffer()
  await sharp({
    create: { width: W * 3 + gap * 2, height: H, channels: 3, background: '#888888' }
  })
    .composite([
      { input: await sharp(refPng).flatten({ background: '#fff' }).resize(W, H, { fit: 'fill' }).png().toBuffer(), left: 0, top: 0 },
      {
        input: candPng
          ? await sharp(candPng).flatten({ background: '#fff' }).resize(W, H, { fit: 'fill' }).png().toBuffer()
          : await panel(Buffer.alloc(W * H, 255), 1),
        left: W + gap,
        top: 0
      },
      { input: await panel(overlay, 3), left: (W + gap) * 2, top: 0 }
    ])
    .png()
    .toFile(cmpPng)
  return score
}

async function main() {
  const { files, out, renderer, entry, pages } = parseArgs(process.argv.slice(2))
  if (!files.length) {
    console.error('usage: run.mjs <file.docx>... [--out dir]')
    process.exit(2)
  }
  const dirs = { ref: join(out, 'ref'), cand: join(out, 'cand'), cmp: join(out, 'cmp') }
  for (const d of Object.values(dirs)) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }

  const docs = new Map(files.map((f) => [stem(f) + extname(f), f]))
  const server = await serve(await bundle(entry), docs)
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('[page]', e.message))

  const report = []
  for (const file of files) {
    const name = stem(file)
    const entry = { file: basename(file), pages: [] }
    try {
      const refPages = renderReference(file, dirs.ref, loProfile(out))
      const candPages =
        renderer === 'officecli'
          ? await renderOfficecli(page, file, dirs.cand)
          : await renderCandidate(page, origin, file, dirs.cand, pages)
      entry.refPages = refPages.length
      entry.candPages = candPages.length
      for (let i = 0; i < refPages.length; i++) {
        const score = await compare(refPages[i], candPages[i] ?? null, join(dirs.cmp, `${name}-${i + 1}.png`))
        entry.pages.push({ page: i + 1, ...score })
      }
      const ious = entry.pages.map((p) => p.inkIoU ?? 0)
      entry.meanIoU = +(ious.reduce((a, b) => a + b, 0) / (ious.length || 1)).toFixed(3)
    } catch (err) {
      entry.error = String(err?.message ?? err)
    }
    report.push(entry)
    console.log(
      `${entry.file.padEnd(36)} pages ref=${entry.refPages ?? '?'} vav=${entry.candPages ?? '?'}  meanIoU=${entry.meanIoU ?? '-'}${entry.error ? '  ERROR ' + entry.error : ''}`
    )
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  server.close()
  console.log(`\n→ ${out}/cmp`)
}

await main()
