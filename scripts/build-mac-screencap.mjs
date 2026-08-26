import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/main/screenshot/macCapture.m')
const outDir = join(root, 'resources/bin')
const out = join(outDir, 'vav_screencap.node')

function nodeIncludeDir() {
  return join(dirname(process.execPath), '..', 'include', 'node')
}

export function ensureMacScreencap() {
  if (process.platform !== 'darwin') return true
  if (!existsSync(src)) {
    console.error('[mac-screencap] missing', src)
    return false
  }
  const include = nodeIncludeDir()
  if (!existsSync(join(include, 'node_api.h'))) {
    console.error('[mac-screencap] node_api.h not found in', include)
    return false
  }
  mkdirSync(outDir, { recursive: true })
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return true
  const result = spawnSync(
    'clang',
    [
      '-shared',
      '-fPIC',
      '-O2',
      '-fobjc-arc',
      '-undefined',
      'dynamic_lookup',
      '-mmacosx-version-min=13.0',
      `-I${include}`,
      '-o',
      out,
      src,
      '-framework',
      'AppKit',
      '-framework',
      'CoreGraphics',
      '-framework',
      'Foundation'
    ],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    console.error('[mac-screencap] clang failed')
    return false
  }
  console.log('[mac-screencap] built', out)
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(ensureMacScreencap() ? 0 : 1)
}
