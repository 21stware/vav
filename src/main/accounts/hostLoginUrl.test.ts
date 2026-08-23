import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loginUrlFromCliOutput } from './hostLoginUrl.ts'

const AUTHORIZE =
  'https://auth.x.ai/oauth2/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A50154%2Fcallback&code_challenge=xyz&code_challenge_method=S256'

describe('loginUrlFromCliOutput', () => {
  it('picks the Grok authorize URL from login --oauth output', () => {
    const text = [
      'Signing in with Grok...',
      '',
      'Open this URL to sign in:',
      `  ${AUTHORIZE}`,
      '',
      "Paste the URL here if it doesn't connect:"
    ].join('\n')
    assert.equal(loginUrlFromCliOutput(text), AUTHORIZE)
  })

  it('prefers authorize over a device-code / activate URL', () => {
    const text = `https://auth.x.ai/activate?user_code=ABCD\n${AUTHORIZE}`
    assert.equal(loginUrlFromCliOutput(text), AUTHORIZE)
  })

  it('rejects a device-code-only dump so we do not open the token page', () => {
    assert.equal(
      loginUrlFromCliOutput('Open https://auth.x.ai/oauth2/device?client_id=abc\nEnter this code'),
      null
    )
    assert.equal(loginUrlFromCliOutput('Visit https://auth.x.ai/activate'), null)
  })
})
