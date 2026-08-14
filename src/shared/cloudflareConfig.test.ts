import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isWranglerConfigName,
  parsePackageDeployScripts,
  parseWorkflowCloudflareHints,
  parseWranglerConfig,
  stripJsonc
} from './cloudflareConfig.ts'

describe('cloudflareConfig', () => {
  it('recognizes wrangler file names', () => {
    assert.equal(isWranglerConfigName('wrangler.toml'), true)
    assert.equal(isWranglerConfigName('wrangler.jsonc'), true)
    assert.equal(isWranglerConfigName('wrangler.json'), true)
    assert.equal(isWranglerConfigName('package.json'), false)
  })

  it('parses wrangler.jsonc with comments and bindings', () => {
    const src = `
      {
        // project
        "name": "docs-site",
        "account_id": "abc123",
        "compatibility_date": "2026-01-15",
        "pages_build_output_dir": "./dist",
        "kv_namespaces": [{ "binding": "CACHE", "id": "kv1" }],
        "d1_databases": [{ "binding": "DB", "database_name": "app" }],
        "env": { "preview": { "name": "docs-site-preview" } }
      }
    `
    const parsed = parseWranglerConfig(src, '/repo/wrangler.jsonc', 'wrangler.jsonc')
    assert.ok(parsed)
    assert.equal(parsed!.kind, 'pages')
    assert.equal(parsed!.name, 'docs-site')
    assert.equal(parsed!.accountId, 'abc123')
    assert.equal(parsed!.compatibilityDate, '2026-01-15')
    assert.equal(parsed!.pagesOutputDir, './dist')
    assert.deepEqual(
      parsed!.bindings.map((b) => b.kind),
      ['kv', 'd1']
    )
    assert.equal(parsed!.environments[0]?.name, 'preview')
  })

  it('parses wrangler.toml workers config', () => {
    const src = `
name = "edge-api"
account_id = "acct"
compatibility_date = "2026-02-01"
main = "src/index.ts"

[[kv_namespaces]]
binding = "KV"
id = "ns1"

[env.production]
name = "edge-api-prod"
`
    const parsed = parseWranglerConfig(src, '/repo/wrangler.toml', 'wrangler.toml')
    assert.ok(parsed)
    assert.equal(parsed!.kind, 'workers')
    assert.equal(parsed!.name, 'edge-api')
    assert.equal(parsed!.main, 'src/index.ts')
    assert.equal(parsed!.bindings[0]?.binding, 'KV')
    assert.equal(parsed!.environments[0]?.projectName, 'edge-api-prod')
  })

  it('strips jsonc comments without eating strings', () => {
    const raw = '{ "a": "http://x", /* c */ "b": 1 } // tail'
    assert.deepEqual(JSON.parse(stripJsonc(raw)), { a: 'http://x', b: 1 })
  })

  it('extracts deploy scripts and workflow hints', () => {
    const scripts = parsePackageDeployScripts(`{
      "scripts": {
        "dev": "vite",
        "deploy": "wrangler deploy",
        "pages": "wrangler pages deploy dist"
      }
    }`)
    assert.deepEqual(scripts, ['deploy', 'pages'])
    const hints = parseWorkflowCloudflareHints(
      'uses: cloudflare/wrangler-action@v3\nrun: wrangler deploy',
      'deploy.yml'
    )
    assert.ok(hints.some((h) => h.includes('wrangler-action')))
  })
})
