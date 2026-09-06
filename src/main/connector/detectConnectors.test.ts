import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { detectConnectors } from './detectConnectors.ts'

describe('detectConnectors', () => {
  it('finds vercel.json and wrangler.toml', () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-connectors-'))
    writeFileSync(join(root, 'vercel.json'), '{"name":"site"}\n', 'utf8')
    writeFileSync(join(root, 'wrangler.toml'), 'name = "worker"\n', 'utf8')
    mkdirSync(join(root, 'supabase'), { recursive: true })
    writeFileSync(join(root, 'supabase', 'config.toml'), 'project_id = "demo"\n', 'utf8')
    const rows = detectConnectors(root)
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
    assert.equal(byId.vercel?.present, true)
    assert.equal(byId.vercel?.label, 'site')
    assert.equal(byId.cloudflare?.present, true)
    assert.equal(byId.supabase?.present, true)
    assert.equal(byId.github?.present, false)
  })
})
