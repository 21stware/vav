import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

prepareBrandedElectron()

// Build first; then launch Electron detached. Keeping electron-vite preview as a
// foreground child meant IDE/agent shells SIGTERM'd the whole group when the
// command ended — the app looked like it "opens then immediately quits".
const build = spawnSync('npx', ['electron-vite', 'build'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})
if (build.status !== 0) process.exit(build.status ?? 1)

const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
if (!existsSync(electronBin)) {
  console.error(`[start] missing Electron binary: ${electronBin}`)
  process.exit(1)
}

console.log('starting electron app (detached)...')

// Absolute app path — a relative "." can resolve wrong once the parent exits.
const child = spawn(electronBin, [root], {
  cwd: root,
  env: { ...process.env, ELECTRON_IS_DEV: '1' },
  detached: true,
  stdio: 'ignore'
})
child.unref()

console.log(`[start] vav pid ${child.pid}`)
