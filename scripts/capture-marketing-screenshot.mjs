#!/usr/bin/env node
/**
 * Seeds demo file sessions and captures each as a standalone file-preview
 * window (no main-shell file-sessions list):
 *   PDF · PPTX · CSV · XLSX · Markdown
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

function sleepSync(ms) {
  spawnSync('sleep', [String(Math.max(0.1, ms / 1000))])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotDir = join(root, 'docs/.screenshot-capture')
const planPath = join(shotDir, 'plan.json')
const manifestPath = join(root, 'docs/marketing-samples/manifest.json')

const outs = {
  pdf: {
    docs: join(root, 'docs/screenshot-pdf.png'),
    site: join(root, 'site/assets/screenshot-pdf.png')
  },
  pptx: {
    docs: join(root, 'docs/screenshot-pptx.png'),
    site: join(root, 'site/assets/screenshot-pptx.png')
  },
  csv: {
    docs: join(root, 'docs/screenshot-csv.png'),
    site: join(root, 'site/assets/screenshot-csv.png')
  },
  xlsx: {
    docs: join(root, 'docs/screenshot-xlsx.png'),
    site: join(root, 'site/assets/screenshot-xlsx.png')
  },
  md: {
    docs: join(root, 'docs/screenshot-md.png'),
    site: join(root, 'site/assets/screenshot-md.png')
  }
}

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

if (!existsSync(manifestPath)) {
  console.error('missing manifest', manifestPath)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const previews = manifest.previews
if (!previews?.pdf) {
  console.error('manifest.previews missing')
  process.exit(1)
}

console.log('stopping existing vav…')
spawnSync('pkill', ['-9', '-f', 'electron/dist/vav.app/Contents/MacOS/vav'], { stdio: 'ignore' })
spawnSync('killall', ['-9', 'vav'], { stdio: 'ignore' })
spawnSync('killall', ['-9', 'VAV'], { stdio: 'ignore' })
const userData = join(homedir(), 'Library/Application Support/vav')
for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
  try {
    rmSync(join(userData, name), { force: true })
  } catch {
    // ignore
  }
}
sleepSync(800)

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

rmSync(shotDir, { recursive: true, force: true })
mkdirSync(shotDir, { recursive: true })

const childEnsureAgent = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Wait for file preview shell + transcript (agent column).
  for (let i = 0; i < 80; i++) {
    const shell = document.querySelector('.file-preview-shell')
    const agentBtn = document.querySelector('.preview-agent-logo-btn')
    if (shell && agentBtn) {
      if (!document.querySelector('.preview-agent-panel')) {
        agentBtn.click()
        await sleep(400)
      }
      // Scroll transcript to show tool cards / charts when present.
      const scroller = document.querySelector('.transcript, .preview-edit-session .scroll')
      if (scroller) scroller.scrollTop = 0
      await sleep(600)
      const ready =
        document.querySelector('.preview-agent-panel .message, .preview-agent-panel .tool-card, .md-vegalite, .md-mermaid, .md-diagram') ||
        document.querySelector('.preview-agent-panel')
      if (ready) return 'agent-ready'
    }
    await sleep(120)
  }
  return 'agent-timeout'
})()`

function openPreviewStep(key, delayMs) {
  const meta = previews[key]
  const js = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const path = ${JSON.stringify(meta.path)}
    const sessionId = ${JSON.stringify(meta.sessionId)}
    try {
      await window.vav.window.openFilePreview(path, {
        origin: 'session',
        conversationId: sessionId
      })
    } catch (err) {
      return 'open-failed:' + String(err)
    }
    await sleep(400)
    return 'opened:${key}'
  })()`
  return { file: `${key}.png`, js, childJs: childEnsureAgent, delayMs, child: true }
}

writeFileSync(
  planPath,
  JSON.stringify(
    {
      dir: shotDir,
      settleMs: 600,
      steps: [
        openPreviewStep('pdf', 2800),
        openPreviewStep('pptx', 3000),
        openPreviewStep('csv', 3200),
        openPreviewStep('xlsx', 3000),
        openPreviewStep('md', 2600)
      ]
    },
    null,
    2
  )
)

console.log('capturing file-preview gallery via VAV_SNAPSHOT_PLAN…')
const shot = spawnSync(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    VAV_SNAPSHOT: '1',
    VAV_SNAPSHOT_PLAN: planPath
  },
  encoding: 'utf8',
  timeout: 240_000
})
process.stdout.write(shot.stdout || '')
process.stderr.write(shot.stderr || '')

function requireShot(name) {
  const path = join(shotDir, `${name}.png`)
  if (!existsSync(path)) {
    console.error('snapshot missing:', path)
    process.exit(1)
  }
  return path
}

const paths = {
  pdf: requireShot('pdf'),
  pptx: requireShot('pptx'),
  csv: requireShot('csv'),
  xlsx: requireShot('xlsx'),
  md: requireShot('md')
}

mkdirSync(join(root, 'site/assets'), { recursive: true })
mkdirSync(join(root, 'docs'), { recursive: true })

copyFileSync(paths.pdf, outs.pdf.docs)
copyFileSync(paths.pdf, outs.pdf.site)
copyFileSync(paths.pptx, outs.pptx.docs)
copyFileSync(paths.pptx, outs.pptx.site)
copyFileSync(paths.csv, outs.csv.docs)
copyFileSync(paths.csv, outs.csv.site)
copyFileSync(paths.xlsx, outs.xlsx.docs)
copyFileSync(paths.xlsx, outs.xlsx.site)
copyFileSync(paths.md, outs.md.docs)
copyFileSync(paths.md, outs.md.site)
// Do not overwrite site/assets/screenshot.png — hero is the coding-chat shot.

rmSync(shotDir, { recursive: true, force: true })

for (const group of Object.values(outs)) {
  for (const path of Object.values(group)) {
    console.log('wrote', path)
  }
}

// The site serves AVIF/WebP derivatives; regenerate them or visitors keep
// seeing the previous capture.
console.log('deriving site image variants…')
const optimize = spawnSync(process.execPath, [join(root, 'scripts/optimize-site-images.mjs')], {
  cwd: root,
  encoding: 'utf8'
})
process.stdout.write(optimize.stdout || '')
process.stderr.write(optimize.stderr || '')
if (optimize.status !== 0) process.exit(optimize.status ?? 1)
