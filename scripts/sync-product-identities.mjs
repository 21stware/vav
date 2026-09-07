#!/usr/bin/env node
/**
 * Keep every packages/* identity on the repo version.
 * Does not move source; product.json stays the shipping contract.
 *
 *   node scripts/sync-product-identities.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function syncProductIdentities(root) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const packagesDir = join(root, 'packages')
  const names = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const synced = []
  for (const name of names) {
    const pkgPath = join(packagesDir, name, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.version = version
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    const productPath = join(packagesDir, name, 'product.json')
    if (existsSync(productPath)) {
      const product = JSON.parse(readFileSync(productPath, 'utf8'))
      product.version = version
      product.name = pkg.name
      writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`)
    }
    synced.push(name)
  }
  return { version, synced }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invoked) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { version, synced } = syncProductIdentities(root)
  process.stdout.write(`products ${version} → ${synced.join(', ')}\n`)
}
