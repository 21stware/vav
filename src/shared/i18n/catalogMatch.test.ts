import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  catalogTextEquals,
  catalogTextIncludes,
  catalogTextStartsWithTemplate
} from './index.ts'

describe('catalog locale matching', () => {
  it('recognizes cancelled in either language', () => {
    assert.equal(catalogTextIncludes('common.cancelled', 'step 已取消'), true)
    assert.equal(catalogTextIncludes('common.cancelled', 'step Cancelled'), true)
    assert.equal(catalogTextIncludes('common.cancelled', 'still running'), false)
  })

  it('matches exact catalog strings in either language', () => {
    assert.equal(catalogTextEquals('tool.askCancelled', '已取消'), true)
    assert.equal(catalogTextEquals('tool.askCancelled', 'Cancelled'), true)
    assert.equal(catalogTextEquals('tool.askCancelled', 'nope'), false)
  })

  it('matches background pid output without the current UI locale', () => {
    assert.equal(catalogTextStartsWithTemplate('tool.backgroundPid', '后台运行 · pid 12'), true)
    assert.equal(catalogTextStartsWithTemplate('tool.backgroundPid', 'Background · pid 12'), true)
    assert.equal(catalogTextStartsWithTemplate('tool.backgroundPid', 'done'), false)
  })
})
