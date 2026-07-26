/**
 * node-pty ships a `spawn-helper` binary that must be executable, but the
 * executable bit is lost whenever the prebuild is extracted by a packer that
 * drops file modes. Without it every pty.spawn fails with "posix_spawnp failed".
 *
 * Runs on postinstall; also safe to run by hand.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `URL.pathname` would hand back "/C:/…" on Windows, which is not a path.
const root = fileURLToPath(new URL('..', import.meta.url))
const ptyRoot = join(root, 'node_modules', 'node-pty')

// Windows has no executable bit, and no spawn-helper either.
if (process.platform !== 'win32' && existsSync(ptyRoot)) {
  for (const dir of [join(ptyRoot, 'prebuilds'), join(ptyRoot, 'build', 'Release')]) {
    if (!existsSync(dir)) continue
    for (const helper of findHelpers(dir)) {
      chmodSync(helper, 0o755)
      console.log(`[vav] chmod +x ${helper}`)
    }
  }
}

function findHelpers(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...findHelpers(full))
    else if (entry === 'spawn-helper') found.push(full)
  }
  return found
}
