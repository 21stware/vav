/**
 * Launch the built app briefly and confirm the process stays up (no boot crash).
 * Run: node scripts/smoke-app-boot.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
prepareBrandedElectron()

const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
if (!existsSync(electronBin)) {
  console.error('missing electron binary')
  process.exit(1)
}

const logDir = join(tmpdir(), 'vav-smoke-boot')
mkdirSync(logDir, { recursive: true })
const logPath = join(logDir, `boot-${Date.now()}.log`)

// Kill stale instances that hold the single-instance lock.
spawnSync('pkill', ['-f', 'Electron.app/Contents/MacOS/Electron|' + electronBin], {
  stdio: 'ignore'
})
// Also branded binary name
spawnSync('pkill', ['-f', 'vav.app/Contents/MacOS/vav'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 400))

const child = spawn(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    VAV_SMOKE_BOOT: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (d) => {
  output += d.toString()
})
child.stderr.on('data', (d) => {
  output += d.toString()
})

const aliveAfterMs = 4500
await new Promise((r) => setTimeout(r, aliveAfterMs))

const stillRunning = child.exitCode === null && !child.killed
writeFileSync(logPath, output)

if (!stillRunning) {
  console.error('FAIL app exited early', child.exitCode, child.signalCode)
  console.error(output.slice(-4000))
  process.exit(1)
}

// Confirm a window via Accessibility / System Events if permitted.
const winCheck = spawnSync(
  'osascript',
  [
    '-e',
    'tell application "System Events" to return (name of processes whose name contains "vav" or name contains "Electron") as string'
  ],
  { encoding: 'utf8' }
)
console.log('ok  process still running after', aliveAfterMs, 'ms (pid', child.pid + ')')
if (winCheck.status === 0) {
  console.log('ok  process list:', (winCheck.stdout || '').trim().slice(0, 200) || '(empty)')
}

child.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 800))
if (child.exitCode === null) child.kill('SIGKILL')

console.log('ok  log at', logPath)
const crashHints = /(TypeError|ReferenceError|UnhandledPromiseRejection|Cannot find module)/i
if (crashHints.test(output)) {
  console.error('FAIL crash signatures in log')
  console.error(output.slice(-4000))
  process.exit(1)
}
console.log('all app boot probes passed')
