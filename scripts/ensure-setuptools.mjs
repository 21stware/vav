/**
 * electron-trackpad-utils' preinstall is:
 *   python3 -m pip show setuptools || python3 -m pip install --user setuptools
 *
 * Homebrew Python (PEP 668, including GitHub macos-14 runners) rejects that
 * pip install, so `npm ci` dies before node-gyp runs. Install setuptools into
 * the same python3 first so `pip show` succeeds.
 */
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)

const show = spawnSync('python3', ['-m', 'pip', 'show', 'setuptools'], { stdio: 'ignore' })
if (show.status === 0) process.exit(0)

if (show.error && show.error.code === 'ENOENT') {
  console.error('[vav] python3 not found; electron-trackpad-utils cannot build')
  process.exit(1)
}

console.log('[vav] installing Python setuptools for electron-trackpad-utils')

function pipInstall(args, extraEnv = {}) {
  return spawnSync('python3', ['-m', 'pip', 'install', ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })
}

let install = pipInstall(['--user', 'setuptools'])
if (install.status !== 0) {
  install = pipInstall(['--user', 'setuptools'], { PIP_BREAK_SYSTEM_PACKAGES: '1' })
}
if (install.status !== 0) {
  install = pipInstall(['--user', '--break-system-packages', 'setuptools'])
}

if (install.status !== 0) {
  console.error('[vav] could not install setuptools; try: brew install python-setuptools')
  process.exit(1)
}
