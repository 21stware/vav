#!/usr/bin/env node
/**
 * Bundle packages/vav-server/src/vav-server.ts into packages/vav-server/vav-server.js
 * for npm publish, plus the vav-board and vav-tui clients.
 *
 *   node scripts/pack-vav-server.mjs
 *   node scripts/pack-vav-server.mjs --dir /tmp/vav-server-pack
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1] ?? undefined
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, 'out', 'phone-ui', 'phone.js'))) {
  const built = spawnSync(process.execPath, [join(root, 'scripts/build-phone-ui.mjs')], {
    cwd: root,
    stdio: process.env.VAV_PACK_QUIET === '1' ? 'ignore' : 'inherit'
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
const canonicalDir = join(root, 'packages', 'vav-server')
const pkgDir = resolve(argValue('--dir') || canonicalDir)
mkdirSync(pkgDir, { recursive: true })
const outfile = join(pkgDir, 'vav-server.js')
const boardOutfile = join(pkgDir, 'vav-board.js')
const tuiOutfile = join(pkgDir, 'vav-tui.js')
const pkgPath = join(pkgDir, 'package.json')
if (!existsSync(pkgPath)) {
  cpSync(join(canonicalDir, 'package.json'), pkgPath)
}

const require = createRequire(import.meta.url)
const esbuildPath = require.resolve('esbuild')
const { build } = await import(pathToFileURL(esbuildPath).href)

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = rootPkg.version
pkg.bin = {
  'vav-server': 'vav-server.js',
  vavd: 'vav-server.js',
  'vav-board': 'vav-board.js',
  vavc: 'vav-board.js',
  'vav-tui': 'vav-tui.js',
  vavcli: 'vav-tui.js'
}
for (const file of ['vav-board.js', 'vav-tui.js']) {
  if (!pkg.files.includes(file)) pkg.files = [...pkg.files, file]
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: {
    '@shared': join(root, 'src/shared'),
    '@main': join(root, 'src/main')
  },
  external: [
    'node-pty',
    'electron',
    'bufferutil',
    'utf-8-validate',
    '@duckdb/node-api',
    '@duckdb/node-bindings'
  ],
  logLevel: process.env.VAV_PACK_QUIET === '1' ? 'warning' : 'info'
}

await build({
  ...shared,
  entryPoints: [join(root, 'packages/vav-server/src/vav-server.ts')],
  outfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'packages/vav-board/src/vav-board.ts')],
  outfile: boardOutfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'packages/vav-tui/src/vav-tui.ts')],
  outfile: tuiOutfile
})

for (const file of [outfile, boardOutfile, tuiOutfile]) {
  let code = readFileSync(file, 'utf8')
  if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`
  writeFileSync(file, code)
  chmodSync(file, 0o755)
}

const phoneUi = existsSync(join(root, 'out', 'phone-ui', 'phone.js'))
  ? join(root, 'out', 'phone-ui')
  : join(root, 'packages/vav-chrome-extension/extension', 'phone')
if (existsSync(join(phoneUi, 'phone.js')) || existsSync(join(phoneUi, 'index.html'))) {
  cpSync(phoneUi, join(pkgDir, 'phone-ui'), { recursive: true })
}

cpSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'))
const readme = join(canonicalDir, 'README.md')
if (existsSync(readme) && pkgDir !== canonicalDir) {
  cpSync(readme, join(pkgDir, 'README.md'))
}

function writeProductPackage(name, binFile, source) {
  const destDir = join(root, 'packages', name)
  mkdirSync(destDir, { recursive: true })
  const destPkg = join(destDir, 'package.json')
  if (existsSync(destPkg)) {
    const next = JSON.parse(readFileSync(destPkg, 'utf8'))
    next.version = rootPkg.version
    writeFileSync(destPkg, `${JSON.stringify(next, null, 2)}\n`)
  }
  cpSync(source, join(destDir, binFile))
  chmodSync(join(destDir, binFile), 0o755)
  if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(destDir, 'LICENSE'))
}

if (pkgDir === canonicalDir) {
  writeProductPackage('vav-board', 'vav-board.js', boardOutfile)
  writeProductPackage('vav-tui', 'vav-tui.js', tuiOutfile)
  const { syncProductIdentities } = await import(pathToFileURL(join(root, 'scripts/sync-product-identities.mjs')).href)
  syncProductIdentities(root)
}

console.log(`[pack-vav-server] ${pkg.name}@${pkg.version} → ${outfile} + ${boardOutfile} + ${tuiOutfile}`)
