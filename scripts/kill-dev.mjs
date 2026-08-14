/**
 * Tear down local electron-vite / branded *dev* VAV processes before a fresh
 * `npm run dev`. Never touch the installed release app (`/Applications/VAV.app`,
 * process name `VAV`, userData `vav`).
 */
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const patterns = [
  'electron-vite',
  'scripts/run-dev.mjs',
  'electron/dist/vav.app',
  'electron/dist/Electron.app',
  'vav.app/Contents/MacOS/vav'
]

for (const pattern of patterns) {
  try {
    execSync(`pkill -f ${JSON.stringify(pattern)}`, { stdio: 'ignore' })
  } catch {
    // no matches
  }
}

// Dev process.title / Dock name after branding. Must NOT match release `VAV`.
for (const name of ['VAV Dev', 'VAVDev']) {
  try {
    execSync(`pkill -x ${JSON.stringify(name)}`, { stdio: 'ignore' })
  } catch {
    // none
  }
}

try {
  execSync('sleep 0.4', { stdio: 'ignore' })
} catch {
  // ignore
}

for (const name of ['VAV Dev', 'VAVDev']) {
  try {
    execSync(`pkill -9 -x ${JSON.stringify(name)}`, { stdio: 'ignore' })
  } catch {
    // none
  }
}

const singletonGlob = join(homedir(), 'Library/Application Support/vav-dev/Singleton')
for (const suffix of ['Lock', 'Cookie', 'Socket']) {
  try {
    rmSync(`${singletonGlob}${suffix}`, { force: true })
  } catch {
    // ignore
  }
}

console.log('[kill-dev] cleared VAV Dev / electron-vite processes')
