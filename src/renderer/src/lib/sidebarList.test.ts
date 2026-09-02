import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationMeta } from '../../../shared/types.ts'
import { t as translate } from '../../../shared/i18n/index.ts'
import {
  agentTypeLabel,
  filterValueLabel,
  groupingOptions,
  modelLabel
} from './sidebarList.ts'

function conv(partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id'>): ConversationMeta {
  return {
    title: partial.title ?? partial.id,
    createdAt: 0,
    updatedAt: 0,
    workingDirectory: '/tmp/ws',
    model: 'x',
    tokensUsed: 0,
    tokenLimit: 0,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    ...partial
  }
}

describe('sidebarList', () => {
  it('resolves model and CLI agent labels', () => {
    assert.equal(agentTypeLabel(conv({ id: 'c1', cliHost: 'vav' }), [{ id: 'claude', name: 'Claude' }]), null)
    assert.equal(
      agentTypeLabel(conv({ id: 'c1', cliHost: 'claude' }), [{ id: 'claude', name: 'Claude' }]),
      'Claude'
    )
    assert.equal(agentTypeLabel(conv({ id: 'c1', cliHost: 'grok' }), []), 'grok')
    assert.ok(modelLabel('unknown-model-xyz') === 'unknown-model-xyz')
  })

  it('lists grouping options and filter labels', () => {
    const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate('en', key, params)
    assert.deepEqual(
      groupingOptions(t).map((row) => row.value),
      ['none', 'workspace', 'provider']
    )
    assert.equal(filterValueLabel({ kind: 'none' }, t), t('sidebar.filter.none'))
    assert.equal(filterValueLabel({ kind: 'favorite' }, t), t('sidebar.filter.favorite'))
    assert.equal(filterValueLabel({ kind: 'workspace', path: '/Users/me/repo' }, t), 'repo')
  })
})
