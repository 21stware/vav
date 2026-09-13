import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Root `dependencies` are what electron-builder copies into the asar.
 * Renderer libraries belong in `devDependencies` — Vite already bundles them.
 */
const PRODUCTION = [
  '@clickhouse/client',
  '@duckdb/node-api',
  '@google-cloud/bigquery',
  'electron-trackpad-utils',
  'electron-updater',
  'mysql2',
  'node-pty',
  'pdfjs-dist',
  'pg'
]

test('root production deps are only main-process externals and natives', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [...PRODUCTION].sort())
})
