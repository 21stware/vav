import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { connectorLoginArgv, connectorLoginBin, connectorLoginNpxPackage } from './cliLoginArgv.ts'

describe('connector CLI login argv', () => {
  it('uses gh web login on github.com', () => {
    assert.equal(connectorLoginBin('github'), 'gh')
    assert.deepEqual(connectorLoginArgv('github'), ['auth', 'login', '-h', 'github.com', '-p', 'https', '-w'])
    assert.equal(connectorLoginNpxPackage('github'), null)
  })

  it('opens vendor login for the deploy CLIs', () => {
    assert.deepEqual(connectorLoginArgv('cloudflare'), ['login'])
    assert.deepEqual(connectorLoginArgv('supabase'), ['login'])
    assert.deepEqual(connectorLoginArgv('vercel'), ['login'])
    assert.equal(connectorLoginNpxPackage('cloudflare'), 'wrangler')
    assert.equal(connectorLoginNpxPackage('supabase'), 'supabase')
    assert.equal(connectorLoginNpxPackage('vercel'), 'vercel')
  })
})
