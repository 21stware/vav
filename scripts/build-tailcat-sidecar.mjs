#!/usr/bin/env node
/**
 * Build the tailcatbridge sidecar (sidecar/tailcatbridge) into resources/bin.
 *
 * Remote control degrades gracefully without the binary (settings shows
 * "component missing"), so a missing Go toolchain is a warning, not a
 * build failure — packagers who want the feature install Go >= 1.23.
 *
 *   node scripts/build-tailcat-sidecar.mjs [--target darwin-arm64|win32-x64] [--force]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sidecarDir = join(root, 'sidecar', 'tailcatbridge')
const outDir = join(root, 'resources', 'bin')

const TARGETS = {
  'darwin-arm64': { GOOS: 'darwin', GOARCH: 'arm64', exe: 'tailcatbridge' },
  'darwin-x64': { GOOS: 'darwin', GOARCH: 'amd64', exe: 'tailcatbridge' },
  'win32-x64': { GOOS: 'windows', GOARCH: 'amd64', exe: 'tailcatbridge.exe' }
}

function hostTarget() {
  return `${process.platform}-${process.arch}`
}

const force = process.argv.includes('--force')
const targetArg = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : hostTarget()
const target = TARGETS[targetArg]
if (!target) {
  console.error(`[tailcat-sidecar] unknown target ${targetArg}`)
  process.exit(1)
}

function sourceStamp() {
  const hash = createHash('sha256')
  for (const name of ['go.mod', 'go.sum']) {
    hash.update(readFileSync(join(sidecarDir, name)))
    hash.update('\0')
  }
  for (const name of readdirSync(sidecarDir)
    .filter((entry) => entry.endsWith('.go'))
    .sort()) {
    hash.update(name)
    hash.update('\0')
    hash.update(readFileSync(join(sidecarDir, name)))
    hash.update('\0')
  }
  hash.update(targetArg)
  return hash.digest('hex')
}

mkdirSync(outDir, { recursive: true })
const out = join(outDir, target.exe)
const stampPath = `${out}.stamp`
const stamp = sourceStamp()
if (!force && existsSync(out) && existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === stamp) {
  console.log(`[tailcat-sidecar] skip ${target.exe} (sources unchanged)`)
  process.exit(0)
}

try {
  execFileSync('go', ['version'], { stdio: 'ignore' })
} catch {
  console.warn('[tailcat-sidecar] Go toolchain not found — skipping (remote control disabled in this build)')
  process.exit(0)
}

console.log(`[tailcat-sidecar] go build → ${out} (${targetArg})`)
const result = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', out, '.'], {
  cwd: sidecarDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    GOTOOLCHAIN: 'auto',
    GOOS: target.GOOS,
    GOARCH: target.GOARCH,
    CGO_ENABLED: '0'
  }
})
if (result.status !== 0) {
  console.error('[tailcat-sidecar] build failed')
  process.exit(result.status ?? 1)
}
if (!existsSync(out)) {
  console.error('[tailcat-sidecar] build produced no binary')
  process.exit(1)
}
writeFileSync(stampPath, `${stamp}\n`)
console.log('[tailcat-sidecar] ok')
