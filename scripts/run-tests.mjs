#!/usr/bin/env node
/**
 * Cross-platform unit-test runner.
 *
 * Replaces the hardcoded file list in package.json so new `*.test.ts` files
 * are picked up automatically. `*.live.test.ts` is skipped unless TEST_LIVE=1
 * or `--live` is passed (those talks to a real accounts store / tailcat DERP).
 */
import { globSync } from 'node:fs'
import { spawn } from 'node:child_process'

const live = process.env.TEST_LIVE === '1' || process.argv.includes('--live')

function isLiveFile(file) {
  return file.replaceAll('\\', '/').includes('.live.test.')
}

const files = ['src/**/*.test.ts', 'scripts/**/*.test.mjs']
  .flatMap((pattern) => globSync(pattern))
  .filter((file) => live || !isLiveFile(file))
  .sort()

if (files.length === 0) {
  console.error('run-tests: no test files matched')
  process.exit(1)
}

const child = spawn(
  process.execPath,
  ['--test', '--experimental-strip-types', '--test-timeout=120000', ...files],
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
