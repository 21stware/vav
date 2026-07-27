#!/usr/bin/env node
/**
 * Seeds English demo data, launches Electron once, and captures a gallery of
 * marketing screenshots (chat / files / terminal / context usage).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotDir = join(root, 'docs/.screenshot-capture')
const planPath = join(shotDir, 'plan.json')

const outs = {
  chat: {
    docs: join(root, 'docs/screenshot.png'),
    site: join(root, 'site/assets/screenshot.png'),
    siteAlt: join(root, 'site/assets/screenshot-chat.png')
  },
  files: {
    docs: join(root, 'docs/screenshot-files.png'),
    site: join(root, 'site/assets/screenshot-files.png')
  },
  terminal: {
    docs: join(root, 'docs/screenshot-terminal.png'),
    site: join(root, 'site/assets/screenshot-terminal.png')
  },
  context: {
    docs: join(root, 'docs/screenshot-context.png'),
    site: join(root, 'site/assets/screenshot-context.png')
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

rmSync(shotDir, { recursive: true, force: true })
mkdirSync(shotDir, { recursive: true })

const helpers = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEMO = 'Payment webhook idempotency'

async function openDemo() {
  const hit = [...document.querySelectorAll('.conv-row')].find((el) =>
    (el.textContent || '').includes(DEMO)
  )
  if (!hit) return null
  hit.click()
  for (let i = 0; i < 60; i++) {
    const ready =
      document.querySelector('.stream-status[data-state="done"]') ||
      [...document.querySelectorAll('.message-turn.assistant .message.assistant')].some((el) =>
        (el.textContent || '').includes('Root cause')
      )
    if (ready) {
      await sleep(400)
      return true
    }
    await sleep(100)
  }
  return false
}

async function raisePanel(delta = -180) {
  const resizer = document.querySelector('.panel-resizer')
  if (!resizer) return
  const rect = resizer.getBoundingClientRect()
  const x = rect.left + 8
  const y = rect.top + 2
  resizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }))
  await sleep(40)
  window.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y + delta })
  )
  await sleep(40)
  window.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y + delta })
  )
  await sleep(200)
}

function clickChipByTitle(substr) {
  const el = [...document.querySelectorAll('button, [role="button"], .chip')].find((node) => {
    const title = node.getAttribute('title') || ''
    const text = node.textContent || ''
    return title.includes(substr) || text.trim() === substr
  })
  el?.click()
  return Boolean(el)
}
`

const jsOpenChat = `(async () => {
  ${helpers}
  const ok = await openDemo()
  if (!ok) return 'missing-demo'
  const scroller = document.querySelector('.transcript')
  if (scroller) scroller.scrollTop = Math.min(220, scroller.scrollHeight)
  await sleep(300)
  return 'chat-ready'
})()`

const jsFiles = `(async () => {
  ${helpers}
  const ok = await openDemo()
  if (!ok) return 'missing-demo'
  // Default segment is files — do not click the folder chip (toggles collapse).
  if (document.querySelector('.tools-body[data-collapsed="true"]')) {
    const expand = [...document.querySelectorAll('button')].find((el) =>
      (el.getAttribute('title') || '').includes('tools')
    )
    expand?.click()
    await sleep(200)
  }
  await raisePanel(-200)
  const src = [...document.querySelectorAll('.tree-row.dir')].find((el) =>
    (el.textContent || '').trim().startsWith('src') ||
    (el.querySelector('.tree-name')?.textContent || '') === 'src'
  )
  src?.click()
  await sleep(450)
  const renderer = [...document.querySelectorAll('.tree-row.dir')].find((el) =>
    (el.querySelector('.tree-name')?.textContent || '') === 'renderer'
  )
  renderer?.click()
  await sleep(400)
  return 'files-ready'
})()`

const jsTerminal = `(async () => {
  ${helpers}
  const ok = await openDemo()
  if (!ok) return 'missing-demo'
  await raisePanel(-200)
  // Prefer an existing bash/Shell tab; otherwise create one.
  const tab = [...document.querySelectorAll('.tools-header-tabs button, .tools-header-tabs .chip')].find(
    (el) => /bash|Shell/i.test(el.textContent || '')
  )
  if (tab) tab.click()
  else {
    const newer = [...document.querySelectorAll('button')].find((el) => {
      const title = el.getAttribute('title') || ''
      return title.includes('New bash') || (el.textContent || '').trim() === 'New'
    })
    newer?.click()
  }
  await sleep(700)
  const list = await window.vav.conversations.list()
  const conv = list.find((c) => (c.title || '').includes(DEMO))
  if (conv) {
    try {
      // Keep output “demo-clean”: avoid `git status` (shows WIP from the capture itself).
      await window.vav.pty.write('agent', 'clear\\r')
      await sleep(250)
      await window.vav.pty.write(
        'agent',
        'pwd; echo; ls src; echo; rg -n \"handleStripeWebhook|event\\\\.id\" src --glob \"*.ts\" 2>/dev/null | head -5; rg -n \"openTokenUsage\" src/renderer --glob \"*.tsx\" | head -4\\r'
      )
    } catch (err) {
      return 'pty-write-failed:' + String(err)
    }
  }
  await sleep(1200)
  return 'terminal-ready'
})()`

const jsContext = `(async () => {
  ${helpers}
  const ok = await openDemo()
  if (!ok) return 'missing-demo'
  const list = await window.vav.conversations.list()
  const conv = list.find((c) => (c.title || '').includes(DEMO))
  if (!conv) return 'missing-conv'
  const ring = document.querySelector('.token-ring, [class*="token"] button, button[title*="context"], button[title*="Context"]')
  const rect = ring?.getBoundingClientRect()
  const anchor = rect
    ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    : undefined
  await window.vav.window.openTokenUsage(conv.id, anchor)
  await sleep(900)
  return 'context-ready'
})()`

writeFileSync(
  planPath,
  JSON.stringify(
    {
      dir: shotDir,
      steps: [
        { file: 'chat.png', js: jsOpenChat, delayMs: 800 },
        { file: 'files.png', js: jsFiles, delayMs: 900 },
        { file: 'terminal.png', js: jsTerminal, delayMs: 1400 },
        { file: 'context.png', js: jsContext, delayMs: 1600, child: true }
      ]
    },
    null,
    2
  )
)

console.log('capturing gallery via VAV_SNAPSHOT_PLAN…')
const shot = spawnSync(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    VAV_SNAPSHOT: '1',
    VAV_SNAPSHOT_PLAN: planPath
  },
  encoding: 'utf8',
  timeout: 180_000
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

const chatPath = requireShot('chat')
const filesPath = requireShot('files')
const terminalPath = requireShot('terminal')
const contextPath = requireShot('context')

mkdirSync(join(root, 'site/assets'), { recursive: true })
mkdirSync(join(root, 'docs'), { recursive: true })

copyFileSync(chatPath, outs.chat.docs)
copyFileSync(chatPath, outs.chat.site)
copyFileSync(chatPath, outs.chat.siteAlt)
copyFileSync(filesPath, outs.files.docs)
copyFileSync(filesPath, outs.files.site)
copyFileSync(terminalPath, outs.terminal.docs)
copyFileSync(terminalPath, outs.terminal.site)
copyFileSync(contextPath, outs.context.docs)
copyFileSync(contextPath, outs.context.site)

rmSync(shotDir, { recursive: true, force: true })

for (const group of Object.values(outs)) {
  for (const path of Object.values(group)) {
    console.log('wrote', path)
  }
}
