#!/usr/bin/env node
/**
 * Serve the desktop renderer in a normal browser with fixture `window.vav`.
 * Cursor / Playwright / Chrome can open these URLs — Electron is not required.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const config = join(root, 'vite.web-preview.config.ts')

console.log(`
vav web preview  http://127.0.0.1:5174/
  If Electron (\`npm run dev\`) is up, this tab attaches to live IPC
  at http://127.0.0.1:5175/ — ego should prefer that origin.
  ?fixture=1         force offline fixture scenes
  ?scene=chat        session + transcript (fixture)
  ?scene=home        workbench home (fixture)
  ?scene=empty       first-run, no API key (fixture)
  ?view=settings     settings window
  ?theme=dark|light
`)

const child = spawn(process.execPath, [vite, '--config', config], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VAV_WEB_PREVIEW: '1' }
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
