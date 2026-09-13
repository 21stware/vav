import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GH_PROXY_PREFIX,
  githubLatestReleaseApiUrl,
  githubProxyGenericFeedUrl,
  isGithubAssetUrl,
  viaGithubProxy
} from './githubProxy.ts'

describe('viaGithubProxy', () => {
  it('prefixes GitHub release and API URLs once', () => {
    const raw = 'https://github.com/21stware/vav/releases/download/v1.28.0/VAV-1.28.0-macos-arm64.zip'
    const proxied = viaGithubProxy(raw)
    assert.equal(proxied, `${GH_PROXY_PREFIX}${raw}`)
    assert.equal(viaGithubProxy(proxied), proxied)
  })

  it('leaves non-GitHub URLs alone', () => {
    assert.equal(viaGithubProxy('https://example.com/app.zip'), 'https://example.com/app.zip')
  })

  it('recognizes GitHub asset hosts', () => {
    assert.equal(isGithubAssetUrl('https://github.com/21stware/vav/releases/latest'), true)
    assert.equal(
      isGithubAssetUrl('https://objects.githubusercontent.com/github-production-release-asset-2e65be/x'),
      true
    )
    assert.equal(isGithubAssetUrl('https://gh-proxy.com/https://github.com/x'), false)
  })
})

describe('update feed URLs', () => {
  it('builds the generic latest/download feed', () => {
    assert.equal(
      githubProxyGenericFeedUrl(),
      'https://gh-proxy.com/https://github.com/21stware/vav/releases/latest/download'
    )
  })

  it('builds the API URL with and without proxy', () => {
    assert.equal(
      githubLatestReleaseApiUrl(false),
      'https://api.github.com/repos/21stware/vav/releases/latest'
    )
    assert.equal(
      githubLatestReleaseApiUrl(true),
      'https://gh-proxy.com/https://api.github.com/repos/21stware/vav/releases/latest'
    )
  })
})
