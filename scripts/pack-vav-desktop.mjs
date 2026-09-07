#!/usr/bin/env node
/**
 * Sync the vav-desktop product identity (Electron source + electron-builder).
 *
 *   node scripts/pack-vav-desktop.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncProductIdentities } from './sync-product-identities.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'packages/vav-desktop/package.json')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

pkg.version = rootPkg.version
pkg.description =
  'VAV desktop workbench. Same sidebar for a local vavd and a paired remote. Electron source is packages/vav-desktop/src.'
pkg.scripts = {
  ...pkg.scripts,
  pack: 'node ../../scripts/pack-vav-desktop.mjs',
  dev: 'npm run dev --prefix ../..',
  start: 'npm start --prefix ../..',
  dist: 'npm run dist --prefix ../..'
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const product = {
  name: pkg.name,
  version: pkg.version,
  role: 'vav-desktop',
  kind: 'electron',
  sources: [
    'packages/vav-desktop/src/main/index.ts',
    'packages/vav-desktop/src/renderer/src/App.tsx',
    'packages/vav-desktop/electron-builder.json'
  ],
  talksTo: ['vavd'],
  hello: ['phone', 'daemon']
}
writeFileSync(join(root, 'packages/vav-desktop/product.json'), `${JSON.stringify(product, null, 2)}\n`)
syncProductIdentities(root)
process.stdout.write(`vav-desktop ${pkg.version} → packages/vav-desktop\n`)
