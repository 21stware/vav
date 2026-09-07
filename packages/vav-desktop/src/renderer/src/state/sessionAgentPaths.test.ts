import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadPreviewAgents, loadWorkspaceAgents, savePreviewAgents, saveWorkspaceAgents } from './sessionAgentPaths.ts'

describe('sessionAgentPaths', () => {
  it('round-trips workspace and preview agent maps through storage', () => {
    const mem: Record<string, string> = {}
    const origGet = globalThis.localStorage
    const fake = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v
      }
    }
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
    try {
      assert.deepEqual(loadWorkspaceAgents(), {})
      saveWorkspaceAgents({ '/tmp/a': 'claude' })
      assert.deepEqual(loadWorkspaceAgents(), { '/tmp/a': 'claude' })
      savePreviewAgents({ '/tmp/b.ts': 's1' })
      assert.deepEqual(loadPreviewAgents(), { '/tmp/b.ts': 's1' })
    } finally {
      if (origGet) Object.defineProperty(globalThis, 'localStorage', { value: origGet, configurable: true })
    }
  })
})
