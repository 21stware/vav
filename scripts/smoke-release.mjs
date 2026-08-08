/**
 * Full reliability smoke for the originai release features.
 * Run: node scripts/smoke-release.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(label, command, args) {
  console.log(`\n== ${label} ==`)
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env
  })
  if (result.status !== 0) {
    console.error(`FAIL ${label} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

run('change-review store', 'bun', [
  '--tsconfig-override',
  'tsconfig.node.json',
  'scripts/_smoke-release-inner.ts'
])
run('shipit orphan cleanup', 'node', ['scripts/smoke-shipit-orphan.mjs'])
run('electron updates', 'npx', ['electron', 'scripts/smoke-electron-updates.mjs'])
run('app boot', 'node', ['scripts/smoke-app-boot.mjs'])
run('ui e2e', 'node', ['scripts/smoke-ui-verify.mjs'])

console.log('\nOK all release smokes passed')
