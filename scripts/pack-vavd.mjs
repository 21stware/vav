#!/usr/bin/env node
/**
 * Bundle src/main/daemon/vavd.ts into packages/vavd/vavd.js for npm publish.
 *
 *   node scripts/pack-vavd.mjs
 *   node scripts/pack-vavd.mjs --dir /tmp/vavd-pack
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1] ?? undefined
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const canonicalDir = join(root, 'packages', 'vavd')
const pkgDir = resolve(argValue('--dir') || canonicalDir)
mkdirSync(pkgDir, { recursive: true })
const outfile = join(pkgDir, 'vavd.js')
const cliOutfile = join(pkgDir, 'vav.js')
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
pkg.bin = { vavd: 'vavd.js', vav: 'vav.js' }
if (!pkg.files.includes('vav.js')) pkg.files = [...pkg.files, 'vav.js']
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: { '@shared': join(root, 'src/shared') },
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
  entryPoints: [join(root, 'src/main/daemon/vavd.ts')],
  outfile
})
await build({
  ...shared,
  entryPoints: [join(root, 'src/main/cli/vavRemoteCli.ts')],
  outfile: cliOutfile
})

for (const file of [outfile, cliOutfile]) {
  let code = readFileSync(file, 'utf8')
  if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`
  writeFileSync(file, code)
  chmodSync(file, 0o755)
}

cpSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'))
const readme = join(canonicalDir, 'README.md')
if (existsSync(readme) && pkgDir !== canonicalDir) {
  cpSync(readme, join(pkgDir, 'README.md'))
}
console.log(`[pack-vavd] ${pkg.name}@${pkg.version} → ${outfile} + ${cliOutfile}`)
