import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBrandedElectron } from './prepare-electron-brand.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

prepareBrandedElectron()

const child = spawn('npx', ['electron-vite', 'dev'], {
  cwd: root,
  env: { ...process.env, ELECTRON_IS_DEV: '1' },
  stdio: 'inherit'
})

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    if (!child.killed) child.kill(signal)
  } catch {
    // already gone
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdown(signal)
    // Give electron-vite a moment to tear down; then exit with the signal.
    setTimeout(() => {
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exit(1)
      }
    }, 400)
  })
}

process.on('exit', () => {
  try {
    if (!child.killed) child.kill('SIGTERM')
  } catch {
    // ignore
  }
})

child.on('exit', (code, signal) => {
  if (shuttingDown) {
    process.exit(code ?? 0)
    return
  }
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
