#!/usr/bin/env node
/**
 * Bundle src/main/daemon/vavd.ts into packages/vavd/vavd.js for npm publish.
 *
 *   node scripts/pack-vavd.mjs
 */
import { chmodSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages', 'vavd')
const outfile = join(pkgDir, 'vavd.js')

const require = createRequire(import.meta.url)
const esbuildPath = require.resolve('esbuild')
const { build } = await import(pathToFileURL(esbuildPath).href)

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pkgPath = join(pkgDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = rootPkg.version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/main/daemon/vavd.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['node-pty', 'electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info'
})

let code = readFileSync(outfile, 'utf8')
if (!code.startsWith('#!')) {
  code = `#!/usr/bin/env node\n${code}`
}
writeFileSync(outfile, code)
chmodSync(outfile, 0o755)

cpSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'))
console.log(`[pack-vavd] ${pkg.name}@${pkg.version} → ${outfile}`)
