import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectCloudflareDeployments, type CloudflareStatus } from './cloudflare.ts'

function status(partial: Partial<CloudflareStatus> = {}): CloudflareStatus {
  return {
    workdir: '/repo',
    config: null,
    extraConfigs: 0,
    ciHints: [],
    tokenPresent: true,
    tokenSource: 'settings',
    accountId: 'acct',
    remote: null,
    remoteError: null,
    remoteCode: null,
    ...partial
  }
}

describe('collectCloudflareDeployments', () => {
  it('returns empty without a remote', () => {
    assert.deepEqual(collectCloudflareDeployments(status()), [])
  })

  it('puts latest first and drops duplicates from recent', () => {
    const latest = {
      id: 'a',
      status: 'success' as const,
      createdAt: '2026-08-01T00:00:00Z',
      url: 'https://a.pages.dev',
      environment: 'production',
      source: 'main'
    }
    const older = {
      id: 'b',
      status: 'failure' as const,
      createdAt: '2026-07-01T00:00:00Z',
      url: null,
      environment: 'preview',
      source: 'dev'
    }
    const rows = collectCloudflareDeployments(
      status({
        remote: {
          found: true,
          kind: 'pages',
          name: 'docs',
          dashboardUrl: 'https://dash.cloudflare.com',
          latest,
          recent: [latest, older]
        }
      })
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.id, 'a')
    assert.equal(rows[1]?.id, 'b')
  })
})
