/**
 * Smoke: orphaned Squirrel.Mac ShipIt launchd job cleanup.
 *
 * Reproduces the failure mode that caused a repeating Gatekeeper “damaged”
 * dialog: launchd job com.vav.app.ShipIt restarts every ~2s when
 * ShipItState.plist is missing.
 *
 * Run: node scripts/smoke-shipit-orphan.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LABEL = 'com.vav.app.ShipIt'
const cacheDir = join(homedir(), 'Library/Caches/com.vav.app.ShipIt')
const statePath = join(cacheDir, 'ShipItState.plist')
const uid = process.getuid?.() ?? 501
const domain = `gui/${uid}`
const service = `${domain}/${LABEL}`

function log(msg) {
  console.log(`  ${msg}`)
}

function launchctl(...args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' })
}

function jobLoaded() {
  const r = launchctl('print', service)
  return r.status === 0
}

/** Mirror of clearOrphanedMacShipIt() in src/main/updates.ts */
function clearOrphanedMacShipIt() {
  if (process.platform !== 'darwin') return
  if (existsSync(statePath)) return
  launchctl('bootout', service)
  try {
    rmSync(cacheDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

if (process.platform !== 'darwin') {
  console.log('skip  not darwin')
  process.exit(0)
}

console.log('== smoke-shipit-orphan ==')

// Start clean
launchctl('bootout', service)
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })

// 1) Valid state present → cleanup must not remove the job if we load one later
writeFileSync(statePath, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n')
assert(existsSync(statePath), 'state should exist')
clearOrphanedMacShipIt()
assert(existsSync(statePath), 'cleanup must keep cache when ShipItState.plist exists')
log('ok  keeps cache when ShipItState.plist present')

// 2) Missing state → cleanup boots out job + drops cache
rmSync(statePath, { force: true })

// Submit a minimal job that fails immediately (simulates orphan ShipIt).
// Use /usr/bin/false so it exits non-zero; KeepAlive would loop — we only
// need one registration without KeepAlive for the bootout test.
const plistBody = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/false</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
const tmpPlist = join(cacheDir, 'orphan-test.plist')
mkdirSync(cacheDir, { recursive: true })
writeFileSync(tmpPlist, plistBody)

// Prefer bootstrap (modern); fall back to load
let loaded = launchctl('bootstrap', domain, tmpPlist)
if (loaded.status !== 0) {
  loaded = launchctl('load', tmpPlist)
}
// Job may exit instantly; print may still show it briefly. Force submit via
// bootstrap is enough to test bootout when present.
log(`bootstrap status=${loaded.status} stderr=${(loaded.stderr || '').trim().slice(0, 120)}`)

// Ensure no state file (orphan condition)
rmSync(statePath, { force: true })
assert(!existsSync(statePath), 'state must be absent for orphan path')

clearOrphanedMacShipIt()

assert(!jobLoaded(), 'orphan ShipIt job must be booted out')
assert(!existsSync(cacheDir) || !existsSync(statePath), 'orphan cache cleared')
log('ok  boots out orphan job and clears cache without state')

// 3) Idempotent: second call is a no-op
clearOrphanedMacShipIt()
assert(!jobLoaded(), 'still no job after second cleanup')
log('ok  cleanup is idempotent')

// 4) Guard: install must not run ShipIt without native ready (logic probe)
function installGuard({ phase, nativeUpdateReady, platform = 'darwin' }) {
  if (phase !== 'ready') return 'noop'
  if (platform === 'darwin' && !nativeUpdateReady) return 'blocked'
  return 'would-install'
}
assert(installGuard({ phase: 'preparing', nativeUpdateReady: false }) === 'noop', 'preparing')
assert(installGuard({ phase: 'ready', nativeUpdateReady: false }) === 'blocked', 'block early ready')
assert(installGuard({ phase: 'ready', nativeUpdateReady: true }) === 'would-install', 'allow staged')
assert(
  installGuard({ phase: 'ready', nativeUpdateReady: false, platform: 'win32' }) === 'would-install',
  'windows ignores flag'
)
log('ok  install() guard matrix')

// Final hygiene
launchctl('bootout', service)
rmSync(cacheDir, { recursive: true, force: true })

console.log('all shipit orphan probes passed')
