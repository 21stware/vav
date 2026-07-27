#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDocs = join(root, 'docs/screenshot.png')
const outSite = join(root, 'site/assets/screenshot.png')
const tmp = join(root, 'docs/.screenshot-capture.png')

prepareBrandedElectron()

console.log('seeding demo data…')
const seed = spawnSync('node', [join(root, 'scripts/seed-marketing-demo.mjs')], {
  cwd: root,
  encoding: 'utf8'
})
if (seed.status !== 0) {
  console.error(seed.stderr || seed.stdout)
  process.exit(seed.status ?? 1)
}
console.log(seed.stdout.trim())

console.log('stopping existing vav…')
spawnSync('pkill', ['-9', '-f', 'electron/dist/vav.app'], { stdio: 'ignore' })
spawnSync('killall', ['-9', 'vav'], { stdio: 'ignore' })

const build = spawnSync('npx', ['electron-vite', 'build'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})
if (build.status !== 0) process.exit(build.status ?? 1)

const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
if (!existsSync(electronBin)) {
  console.error('missing Electron binary', electronBin)
  process.exit(1)
}

mkdirSync(dirname(tmp), { recursive: true })

const snapshotJs = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const hit = [...document.querySelectorAll('.conv-row')]
    .find((el) => (el.textContent || '').includes('Payment webhook idempotency'))
  if (!hit) return 'missing-row'
  hit.click()
  for (let i = 0; i < 50; i++) {
    const ready =
      document.querySelector('.stream-status[data-state="done"]') ||
      [...document.querySelectorAll('.message-turn.assistant .message.assistant')].some(
        (el) => (el.textContent || '').includes('Root cause')
      )
    if (ready) {
      const scroller = document.querySelector('.transcript')
      if (scroller) scroller.scrollTop = 0
      await sleep(500)
      return 'ready'
    }
    await sleep(120)
  }
  return 'timeout'
})()
`

console.log('capturing via VAV_SNAPSHOT…')
const shot = spawnSync(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    VAV_SNAPSHOT: tmp,
    VAV_SNAPSHOT_JS: snapshotJs
  },
  encoding: 'utf8',
  timeout: 90_000
})
process.stdout.write(shot.stdout || '')
process.stderr.write(shot.stderr || '')

if (!existsSync(tmp)) {
  console.error('snapshot file missing')
  process.exit(1)
}

copyFileSync(tmp, outDocs)
copyFileSync(tmp, outSite)
spawnSync('rm', ['-f', tmp])
console.log('wrote', outDocs)
console.log('wrote', outSite)
