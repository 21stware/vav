import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  claudeContextUsed,
  decodeJwtPayload,
  emailFromUnknown,
  hostFromAnthropicBaseUrl,
  parseClaudeAuthStatusPayload,
  parseCodexIdToken,
  parseCursorStatusPayload,
  parseOpencodeAuthFile
} from './cliAccountParse.ts'

function jwtWithPayload(payload: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${json}.sig`
}

describe('decodeJwtPayload', () => {
  it('reads email from a Codex-style id_token', () => {
    const claims = decodeJwtPayload(jwtWithPayload({ email: 'ada@example.com' }))
    assert.equal(claims?.email, 'ada@example.com')
  })

  it('rejects a non-JWT', () => {
    assert.equal(decodeJwtPayload('sk-not-a-jwt'), null)
  })
})

describe('emailFromUnknown', () => {
  it('reads nested Cursor status userInfo.email', () => {
    assert.equal(
      emailFromUnknown({
        isAuthenticated: true,
        userInfo: { email: 'ada@example.com', userId: 1 }
      }),
      'ada@example.com'
    )
  })

  it('ignores account ids that are not emails', () => {
    assert.equal(emailFromUnknown({ accountId: 'acct_123' }), null)
  })
})

describe('parseCursorStatusPayload', () => {
  it('maps cursor-agent status --format json', () => {
    const info = parseCursorStatusPayload({
      status: 'authenticated',
      isAuthenticated: true,
      userInfo: { email: 'ada@example.com' },
      subscriptionTier: 'Ultra'
    })
    assert.deepEqual(info, {
      signedIn: true,
      accountId: 'ada@example.com',
      plan: 'Ultra'
    })
  })
})

describe('parseClaudeAuthStatusPayload', () => {
  it('treats loggedIn from `claude auth status --json` as signed in', () => {
    const info = parseClaudeAuthStatusPayload({
      loggedIn: true,
      authMethod: 'oauth_token',
      apiProvider: 'firstParty'
    })
    assert.equal(info.signedIn, true)
    assert.equal(info.accountId, null)
  })

  it('does not treat a missing CLI payload as signed in', () => {
    assert.equal(parseClaudeAuthStatusPayload(null).signedIn, false)
  })
})

describe('parseCodexIdToken', () => {
  it('prefers email over the ChatGPT account UUID', () => {
    const info = parseCodexIdToken(
      jwtWithPayload({
        email: 'ada@example.com',
        'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1', chatgpt_plan_type: 'plus' }
      })
    )
    assert.deepEqual(info, { signedIn: true, accountId: 'ada@example.com', plan: 'plus' })
  })
})

describe('hostFromAnthropicBaseUrl', () => {
  it('hides the official Anthropic API host', () => {
    assert.equal(hostFromAnthropicBaseUrl('https://api.anthropic.com'), null)
  })

  it('keeps a custom gateway host', () => {
    assert.equal(hostFromAnthropicBaseUrl('https://api.muskapi.cc/v1'), 'api.muskapi.cc')
  })
})

describe('parseOpencodeAuthFile', () => {
  it('treats a stored key as signed in without inventing an email', () => {
    const info = parseOpencodeAuthFile({
      'opencode-go': { type: 'api', key: 'sk-test' }
    })
    assert.deepEqual(info, { signedIn: true, accountId: null, plan: null })
  })
})

describe('claudeContextUsed', () => {
  it('folds cache tokens into the context fill', () => {
    assert.equal(claudeContextUsed({ inputTokens: 10, cacheRead: 4, cacheWrite: 2 }), 16)
  })
})
