#!/usr/bin/env node
/**
 * Download the pinned Cua Driver CLI into resources/bin/.
 *
 * Usage:
 *   node scripts/fetch-cua-driver.mjs
 *   node scripts/fetch-cua-driver.mjs --target darwin-arm64
 *   CUA_DRIVER_VERSION=0.28.1 node scripts/fetch-cua-driver.mjs --force
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources', 'bin')
const VERSION_FILE = join(OUT_DIR, 'cua-driver.version')
const VERSION = process.env.CUA_DRIVER_VERSION || '0.28.1'
const BASE = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}`

/** @typedef {{ asset: string, outName: string, kind: 'tar' | 'zip' }} Target */

/** @type {Record<string, Target>} */
const TARGETS = {
  'darwin-arm64': {
    asset: `cua-driver-rs-${VERSION}-darwin-arm64.tar.gz`,
    outName: 'cua-driver',
    kind: 'tar'
  },
  'darwin-x64': {
    asset: `cua-driver-rs-${VERSION}-darwin-x86_64.tar.gz`,
    outName: 'cua-driver',
    kind: 'tar'
  },
  'win32-x64': {
    asset: `cua-driver-rs-${VERSION}-windows-x86_64-binary.zip`,
    outName: 'cua-driver.exe',
    kind: 'zip'
  },
  'linux-x64': {
    asset: `cua-driver-rs-${VERSION}-linux-x86_64-binary.tar.gz`,
    outName: 'cua-driver',
    kind: 'tar'
  },
  'linux-arm64': {
    asset: `cua-driver-rs-${VERSION}-linux-arm64-binary.tar.gz`,
    outName: 'cua-driver',
    kind: 'tar'
  }
}

function parseArgs(argv) {
  const force = argv.includes('--force')
  const all = argv.includes('--all')
  /** @type {string[]} */
  const targets = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) targets.push(argv[++i])
  }
  return { force, all, targets }
}

function hostKey() {
  const plat = process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (plat === 'darwin') return `darwin-${arch}`
  if (plat === 'win32') return 'win32-x64'
  if (plat === 'linux') return `linux-${arch}`
  throw new Error(`Unsupported host for cua-driver: ${plat}/${process.arch}`)
}

function keysToFetch(opts) {
  if (opts.all) return Object.keys(TARGETS)
  if (opts.targets.length) {
    for (const t of opts.targets) {
      if (!TARGETS[t]) throw new Error(`Unknown --target ${t}`)
    }
    return opts.targets
  }
  return [hostKey()]
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'vav-fetch-cua-driver/1.0', Accept: 'application/octet-stream' },
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
      /* ignore */
    }
    throw err
  }
}

function sha256(file) {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex')
}

function findBinary(dir, outName) {
  const stack = [dir]
  while (stack.length) {
    const here = stack.pop()
    for (const name of readdirSync(here, { withFileTypes: true })) {
      const path = join(here, name.name)
      if (name.isDirectory()) {
        stack.push(path)
        continue
      }
      if (name.name === outName || name.name === 'cua-driver' || name.name === 'cua-driver.exe') {
        return path
      }
    }
  }
  return null
}

function extractArchive(archive, kind, outName) {
  const scratch = mkdtempSync(join(tmpdir(), 'vav-cua-'))
  try {
    if (kind === 'tar') {
      const extracted = spawnSync('tar', ['-xzf', archive, '-C', scratch], { encoding: 'utf8' })
      if (extracted.status !== 0) {
        throw new Error(extracted.stderr || extracted.stdout || 'tar failed')
      }
    } else {
      const extracted = spawnSync(
        'tar',
        process.platform === 'win32' ? ['-xf', archive, '-C', scratch] : ['-xf', archive, '-C', scratch],
        { encoding: 'utf8' }
      )
      if (extracted.status !== 0) {
        throw new Error(extracted.stderr || extracted.stdout || 'unzip failed')
      }
    }
    const found = findBinary(scratch, outName)
    if (!found) throw new Error(`no ${outName} in ${archive}`)
    const dest = join(OUT_DIR, outName)
    renameSync(found, dest)
    if (!outName.endsWith('.exe')) chmodSync(dest, 0o755)
    return dest
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function ensureTarget(key, opts) {
  const t = TARGETS[key]
  const dest = join(OUT_DIR, t.outName)
  let pinned = ''
  try {
    pinned = readFileSync(VERSION_FILE, 'utf8').trim()
  } catch {
    pinned = ''
  }
  if (!opts.force && existsSync(dest) && pinned === VERSION) {
    console.log(`[cua-driver] skip ${t.outName} (v${VERSION} already present)`)
    return t.outName
  }
  const url = `${BASE}/${t.asset}`
  const archive = join(OUT_DIR, t.asset)
  console.log(`[cua-driver] fetching ${url}`)
  await download(url, archive)
  const wrote = extractArchive(archive, t.kind, t.outName)
  try {
    unlinkSync(archive)
  } catch {
    /* keep archive if unlink fails */
  }
  const mb = (readFileSync(wrote).length / 1048576).toFixed(1)
  console.log(`[cua-driver] wrote ${wrote} (${mb} MB, sha256 ${sha256(wrote).slice(0, 12)}…)`)
  return t.outName
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })
  const keys = keysToFetch(opts)
  for (const key of keys) await ensureTarget(key, opts)
  writeFileSync(VERSION_FILE, `${VERSION}\n`)
  console.log(`[cua-driver] ready v${VERSION} → ${OUT_DIR} [${keys.join(', ')}]`)
}

main().catch((err) => {
  console.error('[cua-driver] fetch failed:', err)
  process.exit(1)
})
