#!/usr/bin/env node
/**
 * Bundle packages/vavd/src/vavd.ts into packages/vavd/vavd.js for npm publish.
 *
 *   node scripts/pack-vavd.mjs
 *   node scripts/pack-vavd.mjs --dir /tmp/vavd-pack
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
const canonicalDir = join(root, 'packages', 'vavd')
const pkgDir = resolve(argValue('--dir') || canonicalDir)
mkdirSync(pkgDir, { recursive: true })
const outfile = join(pkgDir, 'vavd.js')
const cliOutfile = join(pkgDir, 'vav.js')
const vavcOutfile = join(pkgDir, 'vavc.js')
const vavcliOutfile = join(pkgDir, 'vavcli.js')
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
pkg.bin = { vavd: 'vavd.js', vav: 'vav.js', vavc: 'vavc.js', vavcli: 'vavcli.js' }
for (const file of ['vav.js', 'vavc.js', 'vavcli.js']) {
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
  entryPoints: [join(root, 'packages/vavd/src/vavd.ts')],
  outfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'src/main/cli/vavRemoteCli.ts')],
  outfile: cliOutfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'packages/vavc/src/vavc.ts')],
  outfile: vavcOutfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'packages/vav-cli/src/vavcli.ts')],
  outfile: vavcliOutfile
})

for (const file of [outfile, cliOutfile, vavcOutfile, vavcliOutfile]) {
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
  writeProductPackage('vavc', 'vavc.js', vavcOutfile)
  writeProductPackage('vav-cli', 'vavcli.js', vavcliOutfile)
  const { syncProductIdentities } = await import(pathToFileURL(join(root, 'scripts/sync-product-identities.mjs')).href)
  syncProductIdentities(root)
}

console.log(`[pack-vavd] ${pkg.name}@${pkg.version} → ${outfile} + ${cliOutfile} + ${vavcOutfile} + ${vavcliOutfile}`)
