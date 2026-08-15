import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TerminalTab } from '@shared/types'
import { retainInstallMeta } from './retainInstallMeta.ts'

function tab(partial: Partial<TerminalTab> & Pick<TerminalTab, 'id' | 'title'>): TerminalTab {
  return {
    isAgent: false,
    agentId: null,
    splitWeight: 1,
    ...partial
  }
}

describe('retainInstallMeta', () => {
  it('keeps the install label when hydrate rebuilds a bash tab', () => {
    const previous = [
      tab({
        id: 'pty-1',
        title: 'Installing Claude Code',
        purpose: 'install',
        installAgentId: 'claude'
      })
    ]
    const projected = [tab({ id: 'pty-1', title: 'curl' })]
    assert.deepEqual(retainInstallMeta(projected, previous), [
      tab({
        id: 'pty-1',
        title: 'Installing Claude Code',
        purpose: 'install',
        installAgentId: 'claude'
      })
    ])
  })

  it('leaves ordinary bash tabs alone', () => {
    const previous = [tab({ id: 'pty-1', title: 'bash-1' })]
    const projected = [tab({ id: 'pty-1', title: 'node' })]
    assert.deepEqual(retainInstallMeta(projected, previous), projected)
  })
})
