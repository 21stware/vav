/**
 * Tear down every local VAV / electron-vite process before a fresh `npm run
 * dev`. Branded binary shows up as process name "VAV", which plain
 * `pkill -f electron/dist/vav.app` often misses once argv is shortened.
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

// Exact process name after branding (Dock / Activity Monitor show "VAV").
try {
  execSync('pkill -x VAV', { stdio: 'ignore' })
} catch {
  // none
}

// Brief wait, then force leftovers.
try {
  execSync('sleep 0.4', { stdio: 'ignore' })
} catch {
  // ignore
}
try {
  execSync('pkill -9 -x VAV', { stdio: 'ignore' })
} catch {
  // none
}

const singletonGlob = join(homedir(), 'Library/Application Support/vav/Singleton')
for (const suffix of ['Lock', 'Cookie', 'Socket']) {
  try {
    rmSync(`${singletonGlob}${suffix}`, { force: true })
  } catch {
    // ignore
  }
}

console.log('[kill-dev] cleared VAV / electron-vite processes')
