#!/usr/bin/env node
/**
 * Build the tailcatbridge sidecar (sidecar/tailcatbridge) into resources/bin.
 *
 * Remote control degrades gracefully without the binary (settings shows
 * "component missing"), so a missing Go toolchain is a warning, not a
 * build failure — packagers who want the feature install Go >= 1.23.
 *
 *   node scripts/build-tailcat-sidecar.mjs [--target darwin-arm64|win32-x64]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
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

const targetArg = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : hostTarget()
const target = TARGETS[targetArg]
if (!target) {
  console.error(`[tailcat-sidecar] unknown target ${targetArg}`)
  process.exit(1)
}

try {
  execFileSync('go', ['version'], { stdio: 'ignore' })
} catch {
  console.warn('[tailcat-sidecar] Go toolchain not found — skipping (remote control disabled in this build)')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
const out = join(outDir, target.exe)
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
console.log('[tailcat-sidecar] ok')
