#!/usr/bin/env node
/**
 * Seeds demo sessions and captures marketing shots in light and dark:
 *   main shell (hero / files / diagrams / terminal)
 *   file-preview windows (pdf, pptx, csv, xlsx, md, mindmap)
 *   isolated quick-ask
 *
 * Writes docs/screenshot*.png and site/assets/screenshot*.png,
 * including *-dark.png companions, then derives AVIF/WebP.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'
import { devUserDataDir } from './dev-user-data.mjs'

function sleepSync(ms) {
  spawnSync('sleep', [String(Math.max(0.1, ms / 1000))])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotDir = join(root, 'docs/.screenshot-capture')
const planPath = join(shotDir, 'plan.json')
const manifestPath = join(root, 'docs/marketing-samples/manifest.json')
const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
const userData = devUserDataDir()
const settingsPath = join(userData, 'settings.json')
const settingsBackup = `${settingsPath}.bak-marketing`

const THEMES = ['light', 'dark']

prepareBrandedElectron()

function killApp() {
  // kill-dev never matches /Applications/VAV.app or process name `VAV`.
  spawnSync(process.execPath, [join(root, 'scripts/kill-dev.mjs')], {
    cwd: root,
    stdio: 'ignore'
  })
  sleepSync(600)
}

function seed(theme) {
  const result = spawnSync('node', [join(root, 'scripts/seed-marketing-demo.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, VAV_MARKETING_THEME: theme }
  })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  process.stdout.write(result.stdout)
}

function js(source) {
  return source
}

function selectSession(id) {
  return js(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const row = document.querySelector('[data-conversation-id="${id}"]')
    if (row) {
      row.click()
      await sleep(700)
      return 'selected'
    }
    return 'missing-row'
  })()`)
}

function clickWorkdirChip() {
  return js(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const chip = document.querySelector('.workdir-chip button')
    if (chip) chip.click()
    await sleep(900)
    const files = document.querySelector('.files-panel, .files-browser, .file-tree')
    return files ? 'files-open' : 'files-unknown'
  })()`)
}

function newBash() {
  return js(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const btn = document.querySelector('[data-testid="new-bash"]')
    if (btn) btn.click()
    await sleep(1400)
    return document.querySelector('.xterm, .terminal-host') ? 'terminal' : 'terminal-unknown'
  })()`)
}

function openSwarm(id) {
  return js(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const row = document.querySelector('[data-conversation-id="${id}"]')
    if (row) {
      row.click()
      await sleep(700)
    }
    const btn = document.querySelector('.agent-mode-swarm-btn')
    if (btn) btn.click()
    for (let i = 0; i < 20; i++) {
      if (document.querySelector('.cli-agent-picker')) break
      await sleep(150)
    }
    await sleep(200)
    if (document.querySelector('.cli-agent-picker')) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', metaKey: true, bubbles: true })
      )
      await sleep(800)
    }
    const pickers = document.querySelectorAll('.cli-agent-picker').length
    return 'swarm:' + pickers
  })()`)
}

function openOverlay(path) {
  return js(`(async () => {
    try {
      await window.vav.window.openOverlay({ path: ${JSON.stringify(path)}, kind: 'app' })
      return 'overlay'
    } catch (err) {
      try {
        await window.vav.window.openFilePreview(${JSON.stringify(path)}, { surface: 'app' })
        return 'overlay-preview'
      } catch (err2) {
        return 'overlay-failed:' + String(err2)
      }
    }
  })()`)
}

function openDetached(id) {
  return js(`(async () => {
    try {
      await window.vav.window.openSession(${JSON.stringify(id)})
      return 'detached'
    } catch (err) {
      return 'detached-failed:' + String(err)
    }
  })()`)
}

const childEnsureAgent = js(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100; i++) {
    const shell = document.querySelector('.file-preview-shell')
    const agentBtn = document.querySelector('.preview-agent-logo-btn')
    if (shell && agentBtn) {
      if (!document.querySelector('.preview-agent-panel')) {
        agentBtn.click()
        await sleep(400)
      }
      const ready = document.querySelector(
        '.preview-agent-panel .message-turn, .preview-agent-panel .tool-card, .md-mermaid, .md-vegalite'
      )
      if (ready) {
        const scroller = document.querySelector('.transcript, .preview-edit-session .scroll')
        if (scroller) scroller.scrollTop = 0
        await sleep(500)
        return 'agent-ready'
      }
    }
    await sleep(150)
  }
  return 'agent-timeout'
})()`)

const childPptxPick = js(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100; i++) {
    const agentBtn = document.querySelector('.preview-agent-logo-btn')
    if (agentBtn && !document.querySelector('.preview-agent-panel')) {
      agentBtn.click()
      await sleep(400)
    }
    if (document.querySelector('.pptx-render-host, .preview-agent-panel .message-turn')) break
    await sleep(150)
  }
  await sleep(900)
  const next = document.querySelector('.doc-page-pager-step:last-of-type')
  if (next && !next.disabled) {
    next.click()
    await sleep(700)
  }
  const shapes = [...document.querySelectorAll('.pptx-shape-pick')]
  const title =
    shapes.find((el) => /blocked/i.test(el.textContent || '')) ||
    shapes[0] ||
    document.querySelector('[data-pptx-slide-index="1"]')
  if (title) {
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await sleep(400)
  }
  const scroller = document.querySelector('.transcript, .preview-edit-session .scroll')
  if (scroller) scroller.scrollTop = 0
  return title ? 'pptx-picked' : 'pptx-no-shape'
})()`)

function openPreviewStep(key, meta, delayMs) {
  const openJs = js(`(async () => {
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
  })()`)
  return { file: `${key}.png`, js: openJs, childJs: childEnsureAgent, delayMs, child: true }
}

function captureTheme(theme, manifest) {
  rmSync(shotDir, { recursive: true, force: true })
  mkdirSync(shotDir, { recursive: true })

  const heroId = manifest.main.hero.sessionId
  const askId = manifest.main.ask.sessionId
  const chartsId = manifest.main.charts.sessionId
  const swarmId = manifest.main.swarm.sessionId
  const previews = manifest.previews
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7)

  let steps = [
    { file: 'screenshot.png', js: selectSession(heroId), delayMs: 400 },
    { file: 'screenshot-files.png', js: clickWorkdirChip(), delayMs: 500 },
    { file: 'screenshot-diagrams.png', js: selectSession(chartsId), delayMs: 900 },
    { file: 'screenshot-terminal.png', js: newBash(), delayMs: 400 },
    { file: 'screenshot-swarm.png', js: openSwarm(swarmId), delayMs: 800 },
    {
      file: 'screenshot-clip.png',
      js: openOverlay(previews.clip.path),
      delayMs: 1800,
      child: true,
      width: 720,
      height: 640
    },
    openPreviewStep('pdf', previews.pdf, 2800),
    {
      file: 'pptx.png',
      js: js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        const path = ${JSON.stringify(previews.pptx.path)}
        const sessionId = ${JSON.stringify(previews.pptx.sessionId)}
        try {
          await window.vav.window.openFilePreview(path, {
            origin: 'session',
            conversationId: sessionId
          })
        } catch (err) {
          return 'open-failed:' + String(err)
        }
        await sleep(400)
        return 'opened:pptx'
      })()`),
      childJs: childPptxPick,
      delayMs: 3200,
      child: true
    },
    openPreviewStep('csv', previews.csv, 3200),
    openPreviewStep('xlsx', previews.xlsx, 3000),
    openPreviewStep('md', previews.md, 2600),
    openPreviewStep('mindmap', previews.mindmap, 2600),
    openPreviewStep('mermaid', previews.mermaid, 2400),
    {
      file: 'screenshot-quick-ask.png',
      js: openDetached(askId),
      delayMs: 1600,
      child: true,
      // Live companion is 400×760 CSS (main-window minWidth × default height).
      width: 400,
      height: 760
    }
  ]
  if (only) {
    steps = steps.filter((step) => step.file.replace(/\.png$/, '').includes(only))
    if (steps.length === 0) {
      console.error('no steps match --only=' + only)
      process.exit(1)
    }
  }

  writeFileSync(
    planPath,
    JSON.stringify(
      {
        dir: shotDir,
        settleMs: 700,
        steps
      },
      null,
      2
    )
  )

  console.log(`capturing ${theme}…`)
  const shot = spawnSync(electronBin, [root], {
    cwd: root,
    env: {
      ...process.env,
      VAV_SNAPSHOT: '1',
      VAV_SNAPSHOT_PLAN: planPath
    },
    encoding: 'utf8',
    timeout: 300_000
  })
  process.stdout.write(shot.stdout || '')
  process.stderr.write(shot.stderr || '')
}

function requireShot(name, required) {
  const path = join(shotDir, name)
  if (!existsSync(path)) {
    if (required) {
      console.error('snapshot missing:', path)
      process.exit(1)
    }
    return null
  }
  return path
}

function destName(base, theme) {
  if (theme === 'light') return base
  return base.replace(/\.png$/, '-dark.png')
}

function publish(theme) {
  const docs = join(root, 'docs')
  const site = join(root, 'site/assets')
  mkdirSync(docs, { recursive: true })
  mkdirSync(site, { recursive: true })

  const map = [
    ['screenshot.png', 'screenshot.png'],
    ['screenshot-files.png', 'screenshot-files.png'],
    ['screenshot-diagrams.png', 'screenshot-diagrams.png'],
    ['screenshot-terminal.png', 'screenshot-terminal.png'],
    ['screenshot-quick-ask.png', 'screenshot-quick-ask.png'],
    ['screenshot-swarm.png', 'screenshot-swarm.png'],
    ['screenshot-clip.png', 'screenshot-clip.png'],
    ['pdf.png', 'screenshot-pdf.png'],
    ['pptx.png', 'screenshot-pptx.png'],
    ['mermaid.png', 'screenshot-mermaid.png'],
    ['csv.png', 'screenshot-csv.png'],
    ['xlsx.png', 'screenshot-xlsx.png'],
    ['md.png', 'screenshot-md.png'],
    ['mindmap.png', 'screenshot-mindmap.png']
  ]

  for (const [srcName, base] of map) {
    const src = requireShot(srcName, false)
    if (!src) continue
    const out = destName(base, theme)
    copyFileSync(src, join(docs, out))
    copyFileSync(src, join(site, out))
    console.log('wrote', out)
  }

  // Skill feature uses the deck write (load_skill + fs_write).
  const skillSrc = requireShot('pptx.png', false)
  if (skillSrc) {
    const skillOut = destName('screenshot-skill.png', theme)
    copyFileSync(skillSrc, join(docs, skillOut))
    copyFileSync(skillSrc, join(site, skillOut))
    console.log('wrote', skillOut)
  }
}

if (!process.argv.includes('--skip-build')) {
  console.log('building renderer…')
  const build = spawnSync('npx', ['electron-vite', 'build'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

if (!existsSync(electronBin)) {
  console.error('missing Electron binary', electronBin)
  process.exit(1)
}

if (existsSync(settingsPath)) copyFileSync(settingsPath, settingsBackup)

for (const theme of THEMES) {
  console.log(`\n=== ${theme} ===`)
  killApp()
  seed(theme)
  if (!existsSync(manifestPath)) {
    console.error('missing manifest', manifestPath)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest.previews?.pdf || !manifest.main?.hero) {
    console.error('manifest incomplete')
    process.exit(1)
  }
  captureTheme(theme, manifest)
  publish(theme)
  killApp()
}

rmSync(shotDir, { recursive: true, force: true })

const convDir = join(userData, 'conversations')
const convBak = `${convDir}.bak-marketing`
if (existsSync(settingsBackup)) {
  copyFileSync(settingsBackup, settingsPath)
  console.log('restored', settingsPath)
}
if (existsSync(convBak)) {
  rmSync(convDir, { recursive: true, force: true })
  spawnSync('cp', ['-R', convBak, convDir])
  console.log('restored', convDir)
}

console.log('\nderiving site image variants…')
const optimize = spawnSync(process.execPath, [join(root, 'scripts/optimize-site-images.mjs'), '--force'], {
  cwd: root,
  encoding: 'utf8'
})
process.stdout.write(optimize.stdout || '')
process.stderr.write(optimize.stderr || '')
if (optimize.status !== 0) process.exit(optimize.status ?? 1)
