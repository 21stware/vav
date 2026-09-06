import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONNECTORS, connectorById } from './connector.ts'

describe('CONNECTORS', () => {
  it('lists github, cloudflare, supabase, and vercel', () => {
    assert.deepEqual(
      CONNECTORS.map((c) => c.id),
      ['github', 'cloudflare', 'supabase', 'vercel']
    )
    assert.ok(connectorById('vercel')?.actions.includes('deploy'))
    assert.equal(connectorById('nope'), null)
  })
})
