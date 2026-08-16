import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  claudeContextUsed,
  decodeJwtPayload,
  emailFromUnknown,
  hostFromAnthropicBaseUrl,
  jwtIsExpired,
  parseClaudeAuthStatusPayload,
  parseCodexAuthFile,
  parseCodexIdToken,
  parseCursorStatusPayload,
  parseDevinAuthStatusText,
  parseOpencodeAuthFile,
  resolveClaudeAccount
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
      plan: 'Ultra',
      authKind: 'oauth'
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
    assert.equal(info.authKind, 'oauth')
  })

  it('maps an API-key auth method', () => {
    const info = parseClaudeAuthStatusPayload({
      loggedIn: true,
      authMethod: 'api_key'
    })
    assert.equal(info.authKind, 'api-key')
    assert.equal(info.signedIn, true)
  })

  it('does not treat a missing CLI payload as signed in', () => {
    assert.equal(parseClaudeAuthStatusPayload(null).signedIn, false)
  })
})

describe('resolveClaudeAccount', () => {
  it('prefers a settings / env token over leftover OAuth login', () => {
    const cli = parseClaudeAuthStatusPayload({
      loggedIn: true,
      authMethod: 'oauth_token',
      apiProvider: 'firstParty'
    })
    const info = resolveClaudeAccount({ token: 'sk-test', customHost: 'api.example.com' }, cli)
    assert.equal(info.authKind, 'token')
    assert.equal(info.signedIn, true)
    assert.equal(info.plan, 'api.example.com')
  })

  it('keeps official OAuth when no token is configured', () => {
    const cli = parseClaudeAuthStatusPayload({
      loggedIn: true,
      authMethod: 'oauth_token',
      apiProvider: 'firstParty'
    })
    const info = resolveClaudeAccount({ token: null, customHost: null }, cli)
    assert.equal(info.authKind, 'oauth')
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
    assert.deepEqual(info, {
      signedIn: true,
      accountId: 'ada@example.com',
      plan: 'plus',
      authKind: 'oauth'
    })
  })

  it('treats an expired id_token as expired, not signed in', () => {
    const info = parseCodexIdToken(jwtWithPayload({ email: 'ada@example.com', exp: 1 }))
    assert.equal(info.signedIn, false)
    assert.equal(info.authKind, 'expired')
  })
})

describe('jwtIsExpired', () => {
  it('is false when exp is in the future or missing', () => {
    assert.equal(jwtIsExpired(jwtWithPayload({ exp: Math.floor(Date.now() / 1000) + 3600 })), false)
    assert.equal(jwtIsExpired(jwtWithPayload({ email: 'ada@example.com' })), false)
  })
})

describe('parseCodexAuthFile', () => {
  it('prefers a live ChatGPT token over an API key in the same file', () => {
    const info = parseCodexAuthFile({
      OPENAI_API_KEY: 'sk-test',
      tokens: {
        id_token: jwtWithPayload({
          email: 'ada@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600
        })
      }
    })
    assert.equal(info.authKind, 'oauth')
    assert.equal(info.accountId, 'ada@example.com')
  })

  it('reads OPENAI_API_KEY when there is no OAuth token', () => {
    const info = parseCodexAuthFile({ OPENAI_API_KEY: 'sk-test' })
    assert.deepEqual(info, {
      signedIn: true,
      accountId: null,
      plan: null,
      authKind: 'api-key'
    })
  })

  it('falls back to env keys when the file is empty', () => {
    const info = parseCodexAuthFile({}, ['sk-from-env'])
    assert.equal(info.authKind, 'api-key')
    assert.equal(info.signedIn, true)
  })

  it('uses an API key when the ChatGPT token is expired', () => {
    const info = parseCodexAuthFile({
      OPENAI_API_KEY: 'sk-test',
      tokens: { id_token: jwtWithPayload({ email: 'ada@example.com', exp: 1 }) }
    })
    assert.equal(info.authKind, 'api-key')
  })

  it('reports expired when tokens are stale and no key is present', () => {
    const info = parseCodexAuthFile({
      tokens: { id_token: jwtWithPayload({ email: 'ada@example.com', exp: 1 }) }
    })
    assert.equal(info.authKind, 'expired')
    assert.equal(info.signedIn, false)
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
    assert.deepEqual(info, { signedIn: true, accountId: null, plan: null, authKind: 'api-key' })
  })
})

describe('parseDevinAuthStatusText', () => {
  it('reads email and plan from `devin auth status`', () => {
    const info = parseDevinAuthStatusText(`Logged in (via Devin).

User:
  Email:             ada@example.com
Account:
  Plan:              Pro
`)
    assert.deepEqual(info, {
      signedIn: true,
      accountId: 'ada@example.com',
      plan: 'Pro',
      authKind: 'oauth'
    })
  })

  it('treats logged-out copy as unsigned', () => {
    const info = parseDevinAuthStatusText('Not logged in.')
    assert.equal(info.signedIn, false)
    assert.equal(info.authKind, 'none')
  })

  it('does not invent unsigned when the CLI output is unreadable', () => {
    const info = parseDevinAuthStatusText('garbage from a new CLI version')
    assert.equal(info.signedIn, false)
    assert.equal(info.authKind, 'unknown')
  })
})

describe('claudeContextUsed', () => {
  it('folds cache tokens into the context fill', () => {
    assert.equal(claudeContextUsed({ inputTokens: 10, cacheRead: 4, cacheWrite: 2 }), 16)
  })
})
