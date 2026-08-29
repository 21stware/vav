import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCliError,
  extractRpcError,
  extractRpcErrorText,
  formatErrorDetail,
  isBareInternalError,
  NETWORK_RETRY_LIMIT,
  networkRetryDelayMs,
  pickExhaustedQuotaWindow,
  RpcErrorCode,
  shouldRetryFreshSession,
  shouldRetrySameSession,
  splitStreamedRetriableError
} from './cliErrors.ts'
import type { QuotaWindow } from './types.ts'

function window(partial: Partial<QuotaWindow> & Pick<QuotaWindow, 'id' | 'kind'>): QuotaWindow {
  return {
    usedPercent: 0,
    resetsAt: null,
    updatedAt: 1,
    ...partial
  }
}

describe('extractRpcError', () => {
  it('keeps the official ACP / JSON-RPC code and prefers data over Internal error', () => {
    const extracted = extractRpcError({
      code: RpcErrorCode.internalError,
      message: 'Internal error',
      data: { details: 'usage limit exceeded' }
    })
    assert.equal(extracted.code, -32603)
    assert.equal(extracted.text, 'usage limit exceeded')
  })

  it('keeps a specific message and appends extra data', () => {
    assert.equal(
      extractRpcErrorText({
        message: 'session not found',
        data: { reason: 'unknown session' }
      }),
      'session not found — unknown session'
    )
  })

  it('reads Error.message and plain strings', () => {
    assert.equal(extractRpcErrorText(new Error('boom')), 'boom')
    assert.equal(extractRpcErrorText('  quota exceeded  '), 'quota exceeded')
  })

  it('formats a details dump with code, message, and JSON', () => {
    const detail = formatErrorDetail({
      code: RpcErrorCode.internalError,
      message: 'Internal error',
      data: { details: 'usage limit exceeded' }
    })
    assert.match(detail, /code -32603/)
    assert.match(detail, /Internal error/)
    assert.match(detail, /usage limit exceeded/)
    assert.match(detail, /"code": -32603/)
  })
})

describe('classifyCliError', () => {
  it('classifies by official ACP / JSON-RPC codes first', () => {
    assert.equal(classifyCliError('Internal error', null, RpcErrorCode.authRequired), 'auth')
    assert.equal(
      classifyCliError('Resource not found: sess-1', null, RpcErrorCode.resourceNotFound),
      'session-stale'
    )
    assert.equal(
      classifyCliError('Resource not found', null, RpcErrorCode.resourceNotFoundLegacy),
      'session-stale'
    )
    assert.equal(classifyCliError('slow down', null, RpcErrorCode.tooManyRequests), 'quota')
    assert.equal(classifyCliError('Internal error', null, RpcErrorCode.internalError), 'generic')
    assert.equal(classifyCliError('Request cancelled'), 'cancelled')
    assert.equal(classifyCliError('Aborted'), 'cancelled')
    assert.equal(classifyCliError('Request aborted'), 'cancelled')
    assert.equal(classifyCliError('Interrupted'), 'cancelled')
    assert.equal(classifyCliError('Turn interrupted'), 'cancelled')
    assert.equal(classifyCliError('Cancelled'), 'cancelled')
  })

  it('maps quota / session / auth wording when no code is present', () => {
    assert.equal(classifyCliError('usage limit exceeded'), 'quota')
    assert.equal(classifyCliError('Rate limit reached'), 'quota')
    assert.equal(
      classifyCliError('API error (status 402 Payment Required): Grok Build usage balance exhausted'),
      'quota'
    )
    assert.equal(classifyCliError('Payment Required', null, 402), 'quota')
    assert.equal(
      classifyCliError(
        'API error (status 402 Payment Required): Grok Build usage balance exhausted',
        null,
        RpcErrorCode.internalError
      ),
      'quota'
    )
    assert.equal(classifyCliError('session not found'), 'session-stale')
    assert.equal(classifyCliError('Resource not found'), 'session-stale')
    assert.equal(classifyCliError('Authentication required'), 'auth')
    assert.equal(classifyCliError('something else'), 'generic')
    assert.equal(
      classifyCliError(
        'RetriableError: [aborted] Client network socket disconnected before secure TLS connection was established'
      ),
      'network'
    )
    assert.equal(classifyCliError('Error: ECONNRESET'), 'network')
    assert.equal(classifyCliError('TLS connection failed'), 'network')
    assert.equal(classifyCliError('getaddrinfo ENOTFOUND api.example.com'), 'network')
    assert.equal(classifyCliError('socket hang up'), 'network')
    assert.equal(classifyCliError('fetch failed'), 'network')
    assert.equal(
      classifyCliError(
        'request error: error sending request for url (https://cli-chat-proxy.grok.com/v1/responses)'
      ),
      'network'
    )
    assert.equal(classifyCliError('connection timed out'), 'network')
    // A user cancel wording must stay 'cancelled', not network.
    assert.equal(classifyCliError('Request was aborted by the user'), 'cancelled')
  })

  it('treats -32603 / Internal error as quota when a window is exhausted', () => {
    const exhausted = [window({ id: 'seven_day', kind: 'seven_day', usedPercent: 100 })]
    assert.equal(classifyCliError('Internal error'), 'generic')
    assert.equal(classifyCliError('Internal error', exhausted), 'quota')
    assert.equal(classifyCliError('Internal error', exhausted, RpcErrorCode.internalError), 'quota')
  })
})

describe('pickExhaustedQuotaWindow', () => {
  it('picks the soonest reset among exhausted windows', () => {
    const picked = pickExhaustedQuotaWindow([
      window({ id: 'monthly', kind: 'monthly', usedPercent: 100, resetsAt: 2000 }),
      window({ id: 'seven_day', kind: 'seven_day', usedPercent: 100, resetsAt: 1000 }),
      window({ id: 'five_hour', kind: 'five_hour', usedPercent: 40, resetsAt: 500 })
    ])
    assert.equal(picked?.id, 'seven_day')
  })
})

describe('shouldRetryFreshSession', () => {
  it('retries stale sessions and -32603 after a resume, never quota/auth/cancel', () => {
    assert.equal(shouldRetryFreshSession('session-stale', 'Resource not found', true, RpcErrorCode.resourceNotFound), true)
    assert.equal(shouldRetryFreshSession('generic', 'Internal error', true, RpcErrorCode.internalError), true)
    assert.equal(shouldRetryFreshSession('quota', 'usage limit exceeded', true), false)
    assert.equal(
      shouldRetryFreshSession(
        'quota',
        'API error (status 402 Payment Required): Grok Build usage balance exhausted',
        true,
        RpcErrorCode.internalError
      ),
      false
    )
    assert.equal(shouldRetryFreshSession('auth', 'Authentication required', true, RpcErrorCode.authRequired), false)
    assert.equal(shouldRetryFreshSession('cancelled', 'Request cancelled', true), false)
    assert.equal(shouldRetryFreshSession('generic', 'Internal error', false, RpcErrorCode.internalError), false)
    // Network blips retry the SAME session (cursor kept) — never a fresh one.
    assert.equal(shouldRetryFreshSession('network', 'any network error', false), false)
    assert.equal(shouldRetryFreshSession('network', 'any network error', true), false)
  })
})

describe('same-session network retry policy', () => {
  it('retries only network errors, with bounded backoff', () => {
    assert.equal(shouldRetrySameSession('network'), true)
    assert.equal(shouldRetrySameSession('quota'), false)
    assert.equal(shouldRetrySameSession('auth'), false)
    assert.equal(shouldRetrySameSession('session-stale'), false)
    assert.equal(shouldRetrySameSession('cancelled'), false)
    assert.equal(shouldRetrySameSession('generic'), false)
    assert.equal(NETWORK_RETRY_LIMIT, 3)
    assert.equal(networkRetryDelayMs(1), 1_000)
    assert.equal(networkRetryDelayMs(2), 2_500)
    assert.equal(networkRetryDelayMs(3), 5_000)
    // Out-of-range attempts clamp to the table bounds.
    assert.equal(networkRetryDelayMs(0), 1_000)
    assert.equal(networkRetryDelayMs(9), 5_000)
  })
})

describe('isBareInternalError', () => {
  it('matches the ACP / JSON-RPC wording only', () => {
    assert.equal(isBareInternalError('Internal error'), true)
    assert.equal(isBareInternalError('JSON-RPC Internal error'), true)
    assert.equal(isBareInternalError('usage limit exceeded'), false)
  })
})

describe('splitStreamedRetriableError', () => {
  it('returns the text untouched when no leak is present', () => {
    assert.deepEqual(splitStreamedRetriableError('e2e acp reply'), {
      text: 'e2e acp reply',
      leaked: null
    })
    assert.deepEqual(splitStreamedRetriableError(''), { text: '', leaked: null })
  })

  it('strips the cursor-agent ACP leak trailing a complete reply', () => {
    const split = splitStreamedRetriableError(
      'PONG\n\nError: RetriableError: WritableIterable is closed'
    )
    assert.equal(split.text, 'PONG')
    assert.equal(split.leaked, 'Error: RetriableError: WritableIterable is closed')
  })

  it('treats a reply that is only the leak as fully leaked', () => {
    const split = splitStreamedRetriableError(
      'Error: RetriableError: WritableIterable is closed'
    )
    assert.equal(split.text, '')
    assert.equal(split.leaked, 'Error: RetriableError: WritableIterable is closed')
  })

  it('strips the TLS flavour and tolerates a trailing newline', () => {
    const split = splitStreamedRetriableError(
      'answer\n\nError: RetriableError: [aborted] Client network socket disconnected before secure TLS connection was established\n'
    )
    assert.equal(split.text, 'answer')
    assert.match(split.leaked ?? '', /^Error: RetriableError: \[aborted\]/)
  })

  it('keeps mid-reply mentions and non-retriable trailing errors', () => {
    // Not the trailing line → model output, not the leak.
    const mid = 'Error: RetriableError: WritableIterable is closed\n\nbut wait, recovered'
    assert.equal(splitStreamedRetriableError(mid).leaked, null)
    // Trailing Error: line without the RetriableError signature → keep.
    const other = 'the command failed\n\nError: ECONNRESET'
    assert.equal(splitStreamedRetriableError(other).leaked, null)
    // Inline mention not at a line start → keep.
    const inline = 'it printed Error: RetriableError: WritableIterable is closed earlier'
    assert.equal(splitStreamedRetriableError(inline).leaked, null)
  })
})
