/**
 * Open File Preview for README.md and dump its DOM text.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronBin = join(root, 'node_modules/electron/dist/vav.app/Contents/MacOS/vav')
const support = join(homedir(), 'Library/Application Support/vav')

spawnSync('pkill', ['-9', '-f', 'vav.app/Contents/MacOS/vav'], { stdio: 'ignore' })
for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  try {
    unlinkSync(join(support, name))
  } catch {
    // ignore
  }
}

const build = spawnSync('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const plan = {
  dir: '/tmp',
  settleMs: 800,
  steps: [
    {
      file: 'vav-preview-child.png',
      delayMs: 2200,
      child: true,
      js: `(async () => {
        await window.vav.window.openFilePreview(${JSON.stringify(join(root, 'README.md'))}, { origin: 'session' });
        return 'opened';
      })()`
    }
  ]
}
const planPath = '/tmp/vav-preview-plan.json'
writeFileSync(planPath, JSON.stringify(plan))

const child = spawn(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    VAV_SNAPSHOT_PLAN: planPath,
    ELECTRON_ENABLE_LOGGING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (d) => {
  output += d
  process.stdout.write(d)
})
child.stderr.on('data', (d) => {
  output += d
  process.stderr.write(d)
})

const code = await new Promise((resolve) => {
  child.on('exit', (c) => resolve(c ?? 1))
  setTimeout(() => {
    child.kill('SIGTERM')
    resolve(124)
  }, 20000)
})

const shot = '/tmp/vav-preview-child.png'
if (!existsSync(shot)) {
  console.error('FAIL no preview screenshot')
  process.exit(1)
}
const size = readFileSync(shot).length
console.log('preview screenshot bytes', size, 'exit', code)
if (size < 5000) {
  console.error('FAIL screenshot too small — likely blank')
  process.exit(1)
}
console.log('OK preview smoke')
