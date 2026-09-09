/**
 * bun preload: make `import ... from 'node:sqlite'` resolve to a bun:sqlite
 * shim so the VAV CLIs run under `bun` (see bunfig.toml `preload`).
 * No-op under Node — this file is only loaded by bun.
 */
import { plugin } from 'bun'
import * as nodeSqlite from './node-sqlite-shim.ts'

plugin({
  name: 'vav:node-sqlite-shim',
  setup(build) {
    build.module('node:sqlite', () => ({ exports: nodeSqlite, loader: 'object' }))
  }
})
