#!/usr/bin/env node
/**
 * Cross-platform unit-test runner.
 *
 * Replaces the hardcoded file list in package.json so new `*.test.ts` files
 * are picked up automatically. `*.live.test.ts` is skipped unless TEST_LIVE=1
 * or `--live` is passed (those talks to a real accounts store / tailcat DERP).
 *
 * `*.browser.test.ts` launches Chrome and talks to the desktop discover ports
 * (4752–4762). A local `npm test` must not run them — they used to SIGTERM
 * whatever was already listening, which quit the production app. CI sets
 * `CI=true` and still runs them; locally use `npm run test:browser`.
 */
import { existsSync, globSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(root, 'out', 'phone-ui', 'phone.js'))) {
  const built = spawnSync(process.execPath, [join(root, 'scripts', 'build-phone-ui.mjs')], {
    cwd: root,
    stdio: 'inherit'
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

const live = process.env.TEST_LIVE === '1' || process.argv.includes('--live')
const browser =
  process.env.TEST_BROWSER === '1' ||
  process.argv.includes('--browser') ||
  process.env.CI === 'true' ||
  process.env.CI === '1'

function isLiveFile(file) {
  return file.replaceAll('\\', '/').includes('.live.test.')
}

function isBrowserFile(file) {
  return file.replaceAll('\\', '/').includes('.browser.test.')
}

const files = ['src/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.mjs']
  .flatMap((pattern) => globSync(pattern))
  .filter((file) => {
    if (isLiveFile(file)) return live
    if (isBrowserFile(file)) return browser
    return true
  })
  .sort()

if (files.length === 0) {
  console.error('run-tests: no test files matched')
  process.exit(1)
}

const child = spawn(
  process.execPath,
  [
    '--import',
    new URL('./register-shared-alias.mjs', import.meta.url).pathname,
    '--test',
    '--experimental-strip-types',
    '--test-timeout=120000',
    ...files
  ],
  {
    stdio: 'inherit'
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
