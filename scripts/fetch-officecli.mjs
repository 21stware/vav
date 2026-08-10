#!/usr/bin/env node
/**
 * Download pinned OfficeCLI release binaries into resources/bin/.
 *
 * Usage:
 *   node scripts/fetch-officecli.mjs
 *   node scripts/fetch-officecli.mjs --target darwin-arm64
 *   node scripts/fetch-officecli.mjs --target win32-x64 --clean
 *   node scripts/fetch-officecli.mjs --all
 *   OFFICECLI_VERSION=1.0.143 node scripts/fetch-officecli.mjs --force
 *
 * Binaries are gitignored; dist/dev scripts call this so packaging always has them.
 */
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources', 'bin')
const VERSION_FILE = join(OUT_DIR, 'officecli.version')
/** Pin — bump intentionally when upgrading OfficeCLI. */
const VERSION = process.env.OFFICECLI_VERSION || '1.0.143'
const BASE = `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${VERSION}`

/** @typedef {{ asset: string, outName: string }} Target */

/** @type {Record<string, Target>} */
const TARGETS = {
  'darwin-arm64': { asset: 'officecli-mac-arm64', outName: 'officecli' },
  'darwin-x64': { asset: 'officecli-mac-x64', outName: 'officecli' },
  'win32-x64': { asset: 'officecli-win-x64.exe', outName: 'officecli.exe' },
  'linux-x64': { asset: 'officecli-linux-x64', outName: 'officecli' },
  'linux-arm64': { asset: 'officecli-linux-arm64', outName: 'officecli' }
}

const KEEP = new Set(['README.md', 'officecli.version'])

function parseArgs(argv) {
  const force = argv.includes('--force')
  const all = argv.includes('--all')
  const clean = argv.includes('--clean')
  /** @type {string[]} */
  const targets = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) {
      targets.push(argv[++i])
    }
  }
  return { force, all, clean, targets }
}

function hostKey() {
  const plat = process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (plat === 'darwin') return `darwin-${arch}`
  if (plat === 'win32') return 'win32-x64'
  if (plat === 'linux') return `linux-${arch}`
  throw new Error(`Unsupported host platform for officecli: ${plat}/${process.arch}`)
}

/** @param {{ all: boolean, targets: string[] }} opts */
function keysToFetch(opts) {
  if (opts.all) return Object.keys(TARGETS)
  if (opts.targets.length) {
    for (const t of opts.targets) {
      if (!TARGETS[t]) throw new Error(`Unknown --target ${t}. Valid: ${Object.keys(TARGETS).join(', ')}`)
    }
    return opts.targets
  }
  return [hostKey()]
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'vav-fetch-officecli/1.0', Accept: 'application/octet-stream' },
    redirect: 'follow'
  })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`)
  }
  const tmp = `${dest}.tmp`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    renameSync(tmp, dest)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw err
  }
}

function sha256(file) {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex')
}

function readPinnedVersion() {
  try {
    return readFileSync(VERSION_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/** Remove stale platform binaries so a mac pack does not ship officecli.exe, etc. */
function cleanOthers(keepNames) {
  if (!existsSync(OUT_DIR)) return
  for (const name of readdirSync(OUT_DIR)) {
    if (KEEP.has(name) || keepNames.has(name)) continue
    if (!name.startsWith('officecli')) continue
    const p = join(OUT_DIR, name)
    unlinkSync(p)
    console.log(`[officecli] removed stale ${name}`)
  }
}

/**
 * @param {string} key
 * @param {{ force: boolean }} opts
 */
async function ensureTarget(key, opts) {
  const t = TARGETS[key]
  if (!t) throw new Error(`Unknown target key: ${key}`)

  const dest = join(OUT_DIR, t.outName)
  const url = `${BASE}/${t.asset}`
  const versionOk = readPinnedVersion() === VERSION
  if (!opts.force && existsSync(dest) && versionOk) {
    console.log(`[officecli] skip ${t.outName} (v${VERSION} already present)`)
    return t.outName
  }

  console.log(`[officecli] fetching ${url}`)
  await download(url, dest)
  if (!t.outName.endsWith('.exe')) {
    try {
      chmodSync(dest, 0o755)
    } catch {
      // ignore
    }
  }
  const mb = (readFileSync(dest).length / 1048576).toFixed(1)
  console.log(`[officecli] wrote ${dest} (${mb} MB, sha256 ${sha256(dest).slice(0, 12)}…)`)
  return t.outName
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })
  const keys = keysToFetch(opts)
  /** @type {Set<string>} */
  const keepNames = new Set()
  for (const key of keys) {
    keepNames.add(await ensureTarget(key, opts))
  }
  if (opts.clean || keys.length === 1) {
    // Default single-target fetch cleans other platform binaries for a lean pack.
    cleanOthers(keepNames)
  }
  writeFileSync(VERSION_FILE, `${VERSION}\n`)
  console.log(`[officecli] ready v${VERSION} → ${OUT_DIR} [${keys.join(', ')}]`)
}

main().catch((err) => {
  console.error('[officecli] fetch failed:', err)
  process.exit(1)
})
