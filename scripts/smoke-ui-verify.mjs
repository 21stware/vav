/**
 * End-to-end UI smoke via VAV_SNAPSHOT + seeded Change Review.
 * Run: node scripts/smoke-ui-verify.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
prepareBrandedElectron()

const build = spawnSync('npx', ['electron-vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})
if (build.status !== 0) process.exit(build.status ?? 1)

const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
if (!existsSync(electronBin)) {
  console.error('missing electron binary')
  process.exit(1)
}

spawnSync(process.execPath, [join(root, 'scripts/kill-dev.mjs')], {
  cwd: root,
  stdio: 'ignore'
})
await new Promise((r) => setTimeout(r, 500))

const outDir = join(tmpdir(), 'vav-smoke-ui')
mkdirSync(outDir, { recursive: true })
const shot = join(outDir, 'smoke.png')

const verifyJs = `(async () => {
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const boot = await window.vav.bootstrap();
  check(!!boot.about?.version, 'about.version');
  check(!!boot.about?.buildNumber, 'about.buildNumber');
  const update = await window.vav.updates.check();
  check(['latest','available'].includes(update.phase), 'updates.phase=' + update.phase);

  let tries = 0;
  while (tries < 50 && !document.querySelector('.change-review')) {
    await new Promise((r) => setTimeout(r, 100));
    tries++;
  }
  check(!!document.querySelector('.change-review'), 'change-review panel visible');

  if (document.querySelector('.change-review')) {
    const rows = document.querySelectorAll('.review-row');
    check(rows.length >= 2, 'review rows >= 2 (got ' + rows.length + ')');
    const acceptAll = [...document.querySelectorAll('button')].find((b) => /Accept All/i.test(b.textContent || ''));
    check(!!acceptAll, 'Accept All button');
    acceptAll?.click();
    await new Promise((r) => setTimeout(r, 600));
    check(!document.querySelector('.change-review'), 'panel closed after Accept All');
  }

  check(!document.querySelector('.banner.review-pending'), 'no pending banner');

  if (update.phase === 'latest') {
    const updateBtn = [...document.querySelectorAll('.titlebar button')].find((b) =>
      /更新|Update|重启|Restart|下载|Download/i.test(b.textContent || '')
    );
    check(!updateBtn, 'toolbar update hidden when latest');
  }

  return JSON.stringify({
    ok: failures.length === 0,
    failures,
    version: boot.about.version,
    buildNumber: boot.about.buildNumber,
    updatePhase: update.phase
  });
})()`

const child = spawn(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    VAV_SMOKE_VERIFY: '1',
    VAV_SMOKE_SEED: '1',
    VAV_SNAPSHOT: shot,
    VAV_SNAPSHOT_JS: verifyJs,
    ELECTRON_ENABLE_LOGGING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (d) => {
  const s = d.toString()
  output += s
  process.stdout.write(s)
})
child.stderr.on('data', (d) => {
  const s = d.toString()
  output += s
  process.stderr.write(s)
})

const code = await new Promise((resolve) => {
  child.on('exit', (c) => resolve(c ?? 1))
  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGTERM')
    resolve(124)
  }, 30000)
})

const marker = '[snapshot] script result:'
const idx = output.lastIndexOf(marker)
if (idx < 0) {
  console.error('FAIL no snapshot script result; exit', code)
  process.exit(1)
}

const raw = output.slice(idx + marker.length).trim()
// Result is a JSON string (possibly quoted by console.log)
let jsonText = raw.split('\n')[0].trim()
if (jsonText.startsWith("'") || jsonText.startsWith('"')) {
  try {
    jsonText = JSON.parse(jsonText)
  } catch {
    jsonText = jsonText.slice(1, -1)
  }
}
let result
try {
  result = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText
} catch (err) {
  console.error('FAIL parse result', jsonText.slice(0, 500), err)
  process.exit(1)
}

if (!result.ok) {
  console.error('FAIL UI verify:', result.failures)
  process.exit(1)
}

console.log('all UI verify probes passed', {
  version: result.version,
  buildNumber: result.buildNumber,
  updatePhase: result.updatePhase
})
process.exit(0)
