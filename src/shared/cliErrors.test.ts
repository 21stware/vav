import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCliError,
  extractRpcError,
  extractRpcErrorText,
  formatErrorDetail,
  isBareInternalError,
  pickExhaustedQuotaWindow,
  RpcErrorCode,
  shouldRetryFreshSession
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
    assert.equal(classifyCliError('session not found'), 'session-stale')
    assert.equal(classifyCliError('Resource not found'), 'session-stale')
    assert.equal(classifyCliError('Authentication required'), 'auth')
    assert.equal(classifyCliError('something else'), 'generic')
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
    assert.equal(shouldRetryFreshSession('auth', 'Authentication required', true, RpcErrorCode.authRequired), false)
    assert.equal(shouldRetryFreshSession('cancelled', 'Request cancelled', true), false)
    assert.equal(shouldRetryFreshSession('generic', 'Internal error', false, RpcErrorCode.internalError), false)
  })
})

describe('isBareInternalError', () => {
  it('matches the ACP / JSON-RPC wording only', () => {
    assert.equal(isBareInternalError('Internal error'), true)
    assert.equal(isBareInternalError('JSON-RPC Internal error'), true)
    assert.equal(isBareInternalError('usage limit exceeded'), false)
  })
})
