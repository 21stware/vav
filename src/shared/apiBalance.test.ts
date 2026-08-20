import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  apiBalanceProviderLabel,
  deepseekBalanceUrl,
  formatApiBalanceAmount,
  parseDeepSeekBalance
} from './apiBalance.ts'

describe('deepseekBalanceUrl', () => {
  it('only accepts the official DeepSeek hosts', () => {
    assert.equal(deepseekBalanceUrl('https://api.deepseek.com'), 'https://api.deepseek.com/user/balance')
    assert.equal(
      deepseekBalanceUrl('https://api.deepseek.com/v1'),
      'https://api.deepseek.com/user/balance'
    )
    assert.equal(
      deepseekBalanceUrl('https://api.deepseek.com/anthropic'),
      'https://api.deepseek.com/user/balance'
    )
    assert.equal(deepseekBalanceUrl('api.deepseek.com/v1'), 'https://api.deepseek.com/user/balance')
    assert.equal(deepseekBalanceUrl('https://api.anthropic.com'), null)
    assert.equal(deepseekBalanceUrl('https://evil.example/deepseek'), null)
    assert.equal(deepseekBalanceUrl('https://api.deepseek.com.evil.test'), null)
  })
})

describe('parseDeepSeekBalance', () => {
  it('reads decimal-string balances and prefers the larger wallet', () => {
    const parsed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        {
          currency: 'USD',
          total_balance: '1.20',
          granted_balance: '0.20',
          topped_up_balance: '1.00'
        },
        {
          currency: 'CNY',
          total_balance: '88.50',
          granted_balance: '8.50',
          topped_up_balance: '80.00'
        }
      ]
    })
    assert.deepEqual(parsed, {
      source: 'deepseek',
      currency: 'CNY',
      total: 88.5,
      granted: 8.5,
      toppedUp: 80,
      available: true
    })
  })

  it('parses the live DeepSeek /user/balance payload', () => {
    const parsed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '69.73',
          granted_balance: '0.00',
          topped_up_balance: '69.73'
        }
      ]
    })
    assert.deepEqual(parsed, {
      source: 'deepseek',
      currency: 'CNY',
      total: 69.73,
      granted: 0,
      toppedUp: 69.73,
      available: true
    })
    assert.match(formatApiBalanceAmount(parsed!), /69.73/)
  })

  it('keeps availability when the wallet list is empty', () => {
    const parsed = parseDeepSeekBalance({ is_available: false, balance_infos: [] })
    assert.equal(parsed?.available, false)
    assert.equal(parsed?.total, 0)
  })
})

describe('formatApiBalanceAmount', () => {
  it('formats CNY and USD without converting', () => {
    assert.match(
      formatApiBalanceAmount({
        source: 'deepseek',
        currency: 'CNY',
        total: 12.3,
        granted: 0,
        toppedUp: 12.3,
        available: true
      }),
      /12.30/
    )
    assert.equal(apiBalanceProviderLabel('deepseek'), 'DeepSeek')
  })
})
