#!/usr/bin/env node
/**
 * Build Tcmobile.xcframework for the VAV Remote iOS app via gomobile.
 *
 * Requires: Go >= 1.23 (auto-upgrades via GOTOOLCHAIN), Xcode with the iOS
 * SDK. Installs gomobile into GOPATH/bin when missing.
 *
 *   node scripts/build-tailcat-ios.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sidecarDir = join(root, 'sidecar', 'tailcatbridge')
const outDir = join(root, 'ios', 'VAVRemote', 'Frameworks')
const out = join(outDir, 'Tcmobile.xcframework')

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) {
    console.error(`[tailcat-ios] ${cmd} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

let gopathBin
try {
  gopathBin = join(execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).trim(), 'bin')
} catch {
  console.error('[tailcat-ios] Go toolchain not found — install Go first')
  process.exit(1)
}
const env = {
  ...process.env,
  GOTOOLCHAIN: 'auto',
  PATH: `${process.env.PATH}:${gopathBin}`
}

for (const tool of ['gomobile', 'gobind']) {
  if (!existsSync(join(gopathBin, tool))) {
    console.log(`[tailcat-ios] installing ${tool}…`)
    run('go', ['install', `golang.org/x/mobile/cmd/${tool}@latest`], { env })
  }
}

mkdirSync(outDir, { recursive: true })
console.log(`[tailcat-ios] gomobile bind → ${out}`)
run('gomobile', ['bind', '-target', 'ios,iossimulator', '-o', out, './mobile'], {
  cwd: sidecarDir,
  env
})
console.log('[tailcat-ios] ok')
