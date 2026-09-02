import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decorateHosts } from './decorateHosts.ts'
import type { WorkspaceHostInfo } from '../../shared/workspaceHost.ts'

const local: WorkspaceHostInfo = {
  id: 'local',
  name: 'This Mac',
  kind: 'local',
  online: true,
  home: '/Users/ada'
}

const remote: WorkspaceHostInfo = {
  id: 'studio',
  name: 'studio',
  kind: 'remote',
  online: true,
  home: '/old-home',
  tmp: '/old-tmp'
}

describe('decorateHosts', () => {
  it('leaves local hosts untouched and overlays daemon facts on remotes', () => {
    const decorated = decorateHosts([local, remote], {
      providersOf: (id) =>
        id === 'studio' ? [{ id: 'claude', name: 'Claude', path: '/bin/claude' }] : [],
      homeOf: () => '/Users/studio',
      tmpOf: () => '/tmp/studio',
      defaultPathOf: () => '/Users/studio/src'
    })
    assert.equal(decorated[0], local)
    assert.equal(decorated[1]?.home, '/Users/studio')
    assert.equal(decorated[1]?.tmp, '/tmp/studio')
    assert.equal(decorated[1]?.defaultPath, '/Users/studio/src')
    assert.deepEqual(decorated[1]?.providers, [
      { id: 'claude', name: 'Claude', path: '/bin/claude' }
    ])
  })
})
